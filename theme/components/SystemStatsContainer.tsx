// pterodactyl-nocturne: live System stats page (/stats).
//
// Aggregates the live resource usage of every server the user can see. Each
// server gets the same Wings websocket the console uses, which pushes a stats
// frame every couple of seconds; servers whose socket can't connect (or past
// MAX_SOCKETS) fall back to the panel's /resources endpoint, which the panel
// caches for 20 seconds. History is kept in memory for the current visit only.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStoreState } from 'easy-peasy';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
    faExclamationTriangle,
    faHdd,
    faMemory,
    faMicrochip,
    faNetworkWired,
} from '@fortawesome/free-solid-svg-icons';
import PageContentBlock from '@/components/elements/PageContentBlock';
import Spinner from '@/components/elements/Spinner';
import Switch from '@/components/elements/Switch';
import getServers from '@/api/getServers';
import getServerResourceUsage from '@/api/server/getServerResourceUsage';
import getWebsocketToken from '@/api/server/getWebsocketToken';
import { Server } from '@/api/server/getServer';
import { Websocket } from '@/plugins/Websocket';
import { usePersistedState } from '@/plugins/usePersistedState';
import { bytesToString, mbToBytes } from '@/lib/formatters';

const MAX_SOCKETS = 40;
const TICK_MS = 2000;
const POLL_MS = 20000;
const MAX_HISTORY = (60 * 60 * 1000) / TICK_MS;
const WINDOWS = [5, 15, 60];
const ALERT = 85;

const ACCENT = 'var(--nocturne-accent, #9184d9)';
const ACCENT_DEEP = 'var(--nocturne-accent-900, #2f2e4a)';
const MUTED = 'var(--nocturne-muted, #9397ab)';
const WARN = 'var(--nocturne-warn, #e6c37a)';
const DANGER = 'var(--nocturne-danger, #ef8f8f)';
const OK = 'var(--nocturne-ok, #7fd1ae)';
const TRACK = 'var(--nocturne-bg-deep, #0f111b)';
const EDGE = '0 0 0 1px color-mix(in srgb, var(--nocturne-text, #e9e9ed) 10%, transparent)';

interface Live {
    state: string;
    cpu: number;
    memory: number;
    disk: number;
    rx: number;
    tx: number;
    rxRate: number;
    txRate: number;
    at: number;
    live: boolean;
}

interface Point {
    t: number;
    cpu: number;
    memory: number;
    perServer: Record<string, number>;
}

const blank = (): Live => ({ state: 'offline', cpu: 0, memory: 0, disk: 0, rx: 0, tx: 0, rxRate: 0, txRate: 0, at: 0, live: false });

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const pct = (used: number, cap: number) => (cap > 0 ? clamp((used / cap) * 100) : 0);
const level = (p: number) => (p > ALERT ? DANGER : p > 70 ? WARN : ACCENT);
const rate = (bytesPerSecond: number) => `${bytesToString(bytesPerSecond, 1)}/s`;
const stateColour = (s: string) => (s === 'running' ? OK : s === 'starting' || s === 'stopping' ? WARN : MUTED);

async function loadAllServers(type?: string): Promise<Server[]> {
    const all: Server[] = [];
    for (let page = 1; page <= 20; page++) {
        const { items, pagination } = await getServers({ page, type });
        all.push(...items);
        if (pagination.currentPage >= pagination.totalPages) break;
    }
    return all;
}

function useLiveStats(servers: Server[] | null) {
    const stats = useRef<Record<string, Live>>({});
    const history = useRef<Point[]>([]);
    const [, setTick] = useState(0);

    // Feed one reading into a server's entry, deriving network rates from the
    // change in byte counters since the previous reading.
    const record = (uuid: string, next: Omit<Live, 'rxRate' | 'txRate' | 'at' | 'live'>, live: boolean) => {
        const prev = stats.current[uuid] || blank();
        const now = Date.now();
        const dt = prev.at ? (now - prev.at) / 1000 : 0;
        stats.current[uuid] = {
            ...next,
            rxRate: dt > 0 && next.rx >= prev.rx ? (next.rx - prev.rx) / dt : prev.rxRate,
            txRate: dt > 0 && next.tx >= prev.tx ? (next.tx - prev.tx) / dt : prev.txRate,
            at: now,
            live: live || (prev.live && now - prev.at < POLL_MS),
        };
    };

    useEffect(() => {
        if (!servers) return;
        stats.current = {};
        history.current = [];
        const sockets: Websocket[] = [];
        let cancelled = false;

        const poll = (server: Server, force = false) => {
            const current = stats.current[server.uuid];
            if (!force && current?.live && Date.now() - current.at < POLL_MS) return;
            getServerResourceUsage(server.uuid)
                .then((s) => {
                    if (cancelled) return;
                    record(
                        server.uuid,
                        {
                            state: s.isSuspended ? 'suspended' : s.status || 'offline',
                            cpu: s.cpuUsagePercent,
                            memory: s.memoryUsageInBytes,
                            disk: s.diskUsageInBytes,
                            rx: s.networkRxInBytes,
                            tx: s.networkTxInBytes,
                        },
                        false
                    );
                })
                .catch(() => undefined);
        };

        const connect = (server: Server) => {
            const socket = new Websocket();
            let refreshing = false;
            const refresh = () => {
                if (refreshing) return;
                refreshing = true;
                getWebsocketToken(server.uuid)
                    .then(({ token }) => socket.setToken(token, true))
                    .catch(() => undefined)
                    .then(() => {
                        refreshing = false;
                    });
            };

            socket.on('auth success', () => socket.send('send stats'));
            socket.on('token expiring', refresh);
            socket.on('token expired', refresh);
            socket.on('jwt error', refresh);
            socket.on('status', (state: string) => {
                const prev = stats.current[server.uuid] || blank();
                stats.current[server.uuid] = { ...prev, state };
            });
            socket.on('stats', (raw: string) => {
                try {
                    const s = JSON.parse(raw);
                    record(
                        server.uuid,
                        {
                            state: s.state || stats.current[server.uuid]?.state || 'offline',
                            cpu: Number(s.cpu_absolute) || 0,
                            memory: Number(s.memory_bytes) || 0,
                            disk: Number(s.disk_bytes) || 0,
                            rx: Number(s.network?.rx_bytes) || 0,
                            tx: Number(s.network?.tx_bytes) || 0,
                        },
                        true
                    );
                } catch {
                    // Ignore malformed frames; the next one will do.
                }
            });

            getWebsocketToken(server.uuid)
                .then(({ token, socket: url }) => {
                    if (cancelled) return;
                    socket.setToken(token).connect(url);
                    sockets.push(socket);
                })
                .catch(() => undefined);
        };

        servers.forEach((server, i) => {
            poll(server, true);
            if (i < MAX_SOCKETS && !server.isTransferring) connect(server);
        });

        const pollTimer = window.setInterval(() => servers.forEach((s) => poll(s)), POLL_MS);
        const tickTimer = window.setInterval(() => {
            const perServer: Record<string, number> = {};
            let cpu = 0;
            let memory = 0;
            servers.forEach((s) => {
                const v = stats.current[s.uuid];
                if (!v) return;
                perServer[s.uuid] = v.cpu;
                cpu += v.cpu;
                memory += v.memory;
            });
            history.current.push({ t: Date.now(), cpu, memory, perServer });
            if (history.current.length > MAX_HISTORY) history.current.shift();
            setTick((n) => n + 1);
        }, TICK_MS);

        return () => {
            cancelled = true;
            window.clearInterval(pollTimer);
            window.clearInterval(tickTimer);
            sockets.forEach((s) => s.close(1000));
        };
    }, [servers]);

    return { stats: stats.current, history: history.current };
}

const Card: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className, style, children }) => (
    <div className={`bg-neutral-700 rounded-lg p-4 flex flex-col ${className || ''}`} style={{ boxShadow: EDGE, ...style }}>
        {children}
    </div>
);

const Bar = ({ value, colour, height = 4 }: { value: number; colour: string; height?: number }) => (
    <div className={'w-full overflow-hidden rounded-full'} style={{ height, background: TRACK }}>
        <div className={'h-full rounded-full'} style={{ width: `${clamp(value)}%`, background: colour, transition: 'width .25s' }} />
    </div>
);

const Segmented = <T extends string | number>({
    options,
    value,
    onChange,
    label,
}: {
    options: { value: T; label: string }[];
    value: T;
    onChange: (v: T) => void;
    label: string;
}) => (
    <div role={'radiogroup'} aria-label={label} className={'inline-flex overflow-hidden rounded border border-neutral-600'}>
        {options.map((o, i) => (
            <button
                key={String(o.value)}
                role={'radio'}
                aria-checked={o.value === value}
                onClick={() => onChange(o.value)}
                className={`px-3 py-1.5 text-sm whitespace-nowrap transition-colors duration-150 ${
                    i > 0 ? 'border-l border-neutral-600' : ''
                } ${o.value === value ? 'text-neutral-50' : 'text-neutral-400 hover:text-neutral-100'}`}
                style={o.value === value ? { boxShadow: `inset 0 0 0 1px ${ACCENT}`, color: ACCENT } : undefined}
            >
                {o.label}
            </button>
        ))}
    </div>
);

interface Kpi {
    icon: IconDefinition;
    label: string;
    value: string;
    sub: string;
    percent: number | null;
}

const KpiCard = ({ kpi }: { kpi: Kpi }) => {
    const alert = kpi.percent !== null && kpi.percent > ALERT;
    return (
        <Card style={alert ? { boxShadow: `0 0 0 1px color-mix(in oklab, ${WARN} 45%, transparent)` } : undefined}>
            <div className={'flex items-center text-xs text-neutral-400'}>
                <FontAwesomeIcon icon={kpi.icon} className={'mr-2'} />
                {kpi.label}
                {alert && (
                    <span className={'ml-auto text-2xs tracking-wider'} style={{ color: WARN }}>
                        ALERT
                    </span>
                )}
            </div>
            <div className={'flex items-baseline mt-2 mb-3'}>
                <span className={'text-2xl text-neutral-50'} style={{ fontWeight: 500, letterSpacing: '-0.01em' }}>
                    {kpi.value}
                </span>
                <span className={'ml-2 text-xs text-neutral-400 truncate'}>{kpi.sub}</span>
            </div>
            <Bar value={kpi.percent ?? 100} colour={kpi.percent === null ? 'var(--nocturne-raised, #363748)' : level(kpi.percent)} />
        </Card>
    );
};

export default () => {
    const uuid = useStoreState((state) => state.user.data!.uuid);
    const rootAdmin = useStoreState((state) => state.user.data!.rootAdmin);
    const [everyone, setEveryone] = usePersistedState(`${uuid}:nocturne_stats_all`, false);
    const [storedWindow, setWindowMin] = usePersistedState<number>(`${uuid}:nocturne_stats_window`, 15);
    const windowMin = storedWindow && WINDOWS.includes(storedWindow) ? storedWindow : 15;
    const [scope, setScope] = useState<string>('all');
    const [servers, setServers] = useState<Server[] | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        setServers(null);
        setError('');
        loadAllServers(rootAdmin && everyone ? 'admin-all' : undefined)
            .then(setServers)
            .catch(() => setError('Could not load your servers. Try refreshing the page.'));
    }, [everyone, rootAdmin]);

    const { stats, history } = useLiveStats(servers);

    const selected = useMemo(() => (servers || []).filter((s) => scope === 'all' || s.uuid === scope), [servers, scope]);

    if (error) {
        return (
            <PageContentBlock title={'System stats'}>
                <p className={'text-center text-sm text-neutral-400'}>{error}</p>
            </PageContentBlock>
        );
    }

    if (!servers) {
        return (
            <PageContentBlock title={'System stats'}>
                <Spinner centered size={'large'} />
            </PageContentBlock>
        );
    }

    // ------------------------------------------------------------- totals ---

    const live = (s: Server) => stats[s.uuid] || blank();
    const sum = (f: (s: Server) => number) => selected.reduce((n, s) => n + f(s), 0);

    const cpuUsed = sum((s) => live(s).cpu);
    const cpuCap = sum((s) => s.limits.cpu || 100);
    const memUsed = sum((s) => live(s).memory);
    const memCap = sum((s) => (s.limits.memory ? mbToBytes(s.limits.memory) : live(s).memory));
    const diskUsed = sum((s) => live(s).disk);
    const diskCap = sum((s) => (s.limits.disk ? mbToBytes(s.limits.disk) : live(s).disk));
    const rxRate = sum((s) => live(s).rxRate);
    const txRate = sum((s) => live(s).txRate);
    const running = selected.filter((s) => live(s).state === 'running').length;
    const connected = selected.filter((s) => live(s).live).length;

    const kpis: Kpi[] = [
        { icon: faMicrochip, label: 'CPU', value: `${cpuUsed.toFixed(0)}%`, sub: `of ${cpuCap}% allocated`, percent: pct(cpuUsed, cpuCap) },
        { icon: faMemory, label: 'Memory', value: bytesToString(memUsed, 1), sub: `/ ${bytesToString(memCap, 1)}`, percent: pct(memUsed, memCap) },
        { icon: faHdd, label: 'Disk', value: bytesToString(diskUsed, 1), sub: `/ ${bytesToString(diskCap, 1)}`, percent: pct(diskUsed, diskCap) },
        { icon: faNetworkWired, label: 'Network', value: rate(rxRate), sub: `in · ${rate(txRate)} out`, percent: null },
    ];
    const diskAlert = selected
        .map((s) => ({ s, p: s.limits.disk ? pct(live(s).disk, mbToBytes(s.limits.disk)) : 0 }))
        .filter(({ p }) => p > ALERT)
        .sort((a, b) => b.p - a.p)[0];

    // -------------------------------------------------------------- chart ---

    const span = windowMin * 60 * 1000;
    const now = Date.now();
    const recent = history.filter((p) => p.t >= now - span);
    const cpuOf = (p: Point) => (scope === 'all' ? p.cpu : p.perServer[scope] || 0);
    const x = (t: number) => (600 * (t - (now - span))) / span;
    const cpuPoints = recent.map((p) => `${x(p.t).toFixed(1)},${(200 - pct(cpuOf(p), cpuCap) * 2).toFixed(1)}`);
    const memPoints =
        scope === 'all'
            ? recent.map((p) => `${x(p.t).toFixed(1)},${(200 - pct(p.memory, memCap) * 2).toFixed(1)}`)
            : [];
    const area = cpuPoints.length > 1 ? `M${cpuPoints[0].split(',')[0]},200 L${cpuPoints.join(' L')} L${cpuPoints[cpuPoints.length - 1].split(',')[0]},200 Z` : '';
    const peak = (s: Server) => recent.reduce((m, p) => Math.max(m, p.perServer[s.uuid] || 0), live(s).cpu);

    // ------------------------------------------------------------ ranking ---

    const ranked = [...selected].sort((a, b) => live(b).cpu - live(a).cpu || live(b).memory - live(a).memory);
    const topCpu = ranked.slice(0, 8);
    const byDisk = [...selected]
        .filter((s) => s.limits.disk > 0)
        .sort((a, b) => live(b).disk / mbToBytes(b.limits.disk) - live(a).disk / mbToBytes(a.limits.disk))
        .slice(0, 6);

    return (
        <PageContentBlock title={'System stats'}>
            <style>{'@keyframes nocturne-pulse{0%,100%{opacity:1}50%{opacity:.35}}'}</style>

            <div className={'flex flex-wrap items-end gap-4 mb-5'}>
                <div>
                    <h1 className={'text-2xl text-neutral-50 m-0'}>System stats</h1>
                    <p className={'flex items-center text-sm text-neutral-400 mt-1'}>
                        <span
                            className={'inline-block w-2 h-2 rounded-full mr-2'}
                            style={{ background: connected ? OK : MUTED, animation: connected ? 'nocturne-pulse 2s infinite' : 'none' }}
                        />
                        {selected.length} server{selected.length === 1 ? '' : 's'} · {running} running ·{' '}
                        {connected > 0 ? `${connected} streaming live` : 'connecting…'}
                    </p>
                </div>
                <div className={'ml-auto flex flex-wrap items-center gap-3'}>
                    {rootAdmin && (
                        <label className={'flex items-center text-xs uppercase text-neutral-400 gap-2'}>
                            All users
                            <Switch name={'nocturne_stats_all'} defaultChecked={everyone} onChange={() => setEveryone((v) => !v)} />
                        </label>
                    )}
                    <select
                        aria-label={'Scope'}
                        value={scope}
                        onChange={(e) => setScope(e.target.value)}
                        className={'bg-neutral-600 border border-neutral-500 rounded text-sm text-neutral-100 px-3 py-1.5'}
                    >
                        <option value={'all'}>All servers</option>
                        {servers.map((s) => (
                            <option key={s.uuid} value={s.uuid}>
                                {s.name}
                            </option>
                        ))}
                    </select>
                    <Segmented
                        label={'Window'}
                        value={windowMin}
                        onChange={setWindowMin}
                        options={WINDOWS.map((w) => ({ value: w, label: `${w} min` }))}
                    />
                </div>
            </div>

            {servers.length === 0 ? (
                <p className={'text-center text-sm text-neutral-400'}>There are no servers to show yet.</p>
            ) : (
                <>
                    {diskAlert && (
                        <div
                            className={'flex items-center gap-3 rounded px-4 py-2.5 mb-4 text-sm'}
                            style={{
                                background: `color-mix(in oklab, ${WARN} 10%, var(--nocturne-surface, #2b2c3d))`,
                                boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${WARN} 40%, transparent)`,
                            }}
                        >
                            <FontAwesomeIcon icon={faExclamationTriangle} style={{ color: WARN }} />
                            <span>
                                <span className={'text-neutral-50'}>
                                    {diskAlert.s.name} disk at {diskAlert.p.toFixed(0)}%
                                </span>
                                <span className={'text-neutral-300'}> · alert threshold {ALERT}%</span>
                            </span>
                        </div>
                    )}

                    <div className={'grid gap-3 mb-3'} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                        {kpis.map((k) => (
                            <KpiCard key={k.label} kpi={k} />
                        ))}
                    </div>

                    <div className={'grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3'}>
                        <Card className={'lg:col-span-2'}>
                            <div className={'flex flex-wrap items-center gap-4 mb-3'}>
                                <span className={'text-base text-neutral-50'}>
                                    {scope === 'all' ? 'CPU & memory' : `${selected[0]?.name} CPU`}
                                </span>
                                <span className={'flex items-center text-xs text-neutral-300'}>
                                    <span className={'inline-block w-3.5 mr-1.5'} style={{ height: 2, background: ACCENT }} />
                                    CPU
                                </span>
                                {scope === 'all' && (
                                    <span className={'flex items-center text-xs text-neutral-300'}>
                                        <span className={'inline-block w-3.5 mr-1.5'} style={{ height: 2, background: MUTED }} />
                                        Memory
                                    </span>
                                )}
                                <span className={'ml-auto font-mono text-2xs text-neutral-500'}>
                                    {TICK_MS / 1000}s samples · % of allocation
                                </span>
                            </div>
                            <svg viewBox={'0 0 600 200'} preserveAspectRatio={'none'} style={{ width: '100%', height: 220, display: 'block' }}>
                                <defs>
                                    <linearGradient id={'nocturneCpuFill'} x1={'0'} x2={'0'} y1={'0'} y2={'1'}>
                                        <stop offset={'0'} stopColor={'#9184d9'} style={{ stopColor: ACCENT }} stopOpacity={0.28} />
                                        <stop offset={'1'} stopColor={'#9184d9'} style={{ stopColor: ACCENT }} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                {[50, 100, 150].map((y) => (
                                    <line key={y} x1={0} x2={600} y1={y} y2={y} stroke={TRACK} strokeWidth={1} />
                                ))}
                                <line x1={0} x2={600} y1={20} y2={20} stroke={WARN} strokeWidth={1} strokeDasharray={'4 4'} opacity={0.7} vectorEffect={'non-scaling-stroke'} />
                                {area && <path d={area} fill={'url(#nocturneCpuFill)'} />}
                                {memPoints.length > 1 && (
                                    <polyline points={memPoints.join(' ')} fill={'none'} stroke={MUTED} strokeWidth={1.5} vectorEffect={'non-scaling-stroke'} />
                                )}
                                {cpuPoints.length > 1 && (
                                    <polyline points={cpuPoints.join(' ')} fill={'none'} stroke={ACCENT} strokeWidth={2} vectorEffect={'non-scaling-stroke'} />
                                )}
                            </svg>
                            <div className={'flex justify-between font-mono text-2xs text-neutral-500 mt-2'}>
                                <span>−{windowMin} min</span>
                                <span>alert 90%</span>
                                <span>now</span>
                            </div>
                        </Card>

                        <Card>
                            <div className={'flex items-center mb-3'}>
                                <span className={'text-base text-neutral-50'}>CPU by server</span>
                                <span className={'ml-auto text-xs text-neutral-400'}>% of each allocation</span>
                            </div>
                            <div className={'grid gap-1.5 items-end'} style={{ gridTemplateColumns: `repeat(${Math.max(topCpu.length, 1)}, 1fr)`, height: 150 }}>
                                {topCpu.map((s) => {
                                    const p = pct(live(s).cpu, s.limits.cpu || 100);
                                    return (
                                        <div key={s.uuid} className={'flex flex-col items-center h-full justify-end gap-1.5'} title={`${s.name}: ${live(s).cpu.toFixed(1)}%`}>
                                            <div className={'w-full flex-1 flex items-end rounded overflow-hidden'} style={{ background: TRACK }}>
                                                <div className={'w-full'} style={{ height: `${Math.max(p, 1)}%`, background: level(p), transition: 'height .25s' }} />
                                            </div>
                                            <span className={'font-mono text-2xs text-neutral-500 truncate w-full text-center'}>{s.name.slice(0, 4)}</span>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className={'grid grid-cols-2 gap-2.5 text-xs mt-4'}>
                                <div className={'flex flex-col'}>
                                    <span className={'text-neutral-400'}>Network in</span>
                                    <span className={'font-mono text-neutral-100'}>{rate(rxRate)}</span>
                                </div>
                                <div className={'flex flex-col'}>
                                    <span className={'text-neutral-400'}>Network out</span>
                                    <span className={'font-mono text-neutral-100'}>{rate(txRate)}</span>
                                </div>
                                <div className={'flex flex-col'}>
                                    <span className={'text-neutral-400'}>Running</span>
                                    <span className={'font-mono text-neutral-100'}>
                                        {running} / {selected.length}
                                    </span>
                                </div>
                                <div className={'flex flex-col'}>
                                    <span className={'text-neutral-400'}>Live sockets</span>
                                    <span className={'font-mono text-neutral-100'}>{connected}</span>
                                </div>
                            </div>
                        </Card>
                    </div>

                    <div className={'grid grid-cols-1 lg:grid-cols-3 gap-3'}>
                        <Card>
                            <span className={'text-base text-neutral-50 mb-3'}>Disk by server</span>
                            {byDisk.length === 0 && <p className={'text-xs text-neutral-400'}>No servers with a disk limit.</p>}
                            {byDisk.map((s) => {
                                const p = pct(live(s).disk, mbToBytes(s.limits.disk));
                                return (
                                    <div key={s.uuid} className={'flex flex-col gap-1.5 mb-3'}>
                                        <div className={'flex text-xs gap-2'}>
                                            <span className={'font-mono text-neutral-100 truncate'}>{s.name}</span>
                                            <span className={'ml-auto text-neutral-400 whitespace-nowrap'}>
                                                {bytesToString(live(s).disk, 1)} / {bytesToString(mbToBytes(s.limits.disk), 0)}
                                            </span>
                                            <span className={'w-9 text-right'} style={{ color: p > ALERT ? WARN : ACCENT }}>
                                                {p.toFixed(0)}%
                                            </span>
                                        </div>
                                        <Bar value={p} colour={p > ALERT ? WARN : ACCENT} height={6} />
                                    </div>
                                );
                            })}
                        </Card>

                        <Card className={'lg:col-span-2 min-w-0'}>
                            <div className={'flex items-center gap-2 mb-2'}>
                                <span className={'text-base text-neutral-50'}>Server ranking</span>
                                <span className={'text-xs text-neutral-400'}>peak over {windowMin} min</span>
                            </div>
                            <div className={'overflow-x-auto'}>
                                <table className={'w-full text-sm'} style={{ borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr className={'text-left text-2xs uppercase tracking-wider text-neutral-400'}>
                                            <th className={'py-2 pr-2 font-medium'}>Server</th>
                                            <th className={'py-2 px-2 font-medium'}>State</th>
                                            <th className={'py-2 px-2 font-medium text-right'}>CPU</th>
                                            <th className={'py-2 px-2 font-medium text-right'}>Memory</th>
                                            <th className={'py-2 px-2 font-medium text-right'}>Peak</th>
                                            <th className={'py-2 pl-2 font-medium text-right'}>Net</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ranked.map((s, i) => {
                                            const v = live(s);
                                            return (
                                                <tr key={s.uuid} className={'border-t border-neutral-600'}>
                                                    <td className={'py-2 pr-2'}>
                                                        <Link to={`/server/${s.id}`} className={'flex items-center gap-2 no-underline text-neutral-100 hover:text-neutral-50'}>
                                                            <span className={'font-mono text-2xs text-neutral-500'}>{String(i + 1).padStart(2, '0')}</span>
                                                            <span className={'truncate'}>{s.name}</span>
                                                        </Link>
                                                    </td>
                                                    <td className={'py-2 px-2 text-xs whitespace-nowrap'} style={{ color: stateColour(v.state) }}>
                                                        ● {v.state}
                                                    </td>
                                                    <td className={'py-2 px-2 text-right font-mono'}>{v.cpu.toFixed(1)}%</td>
                                                    <td className={'py-2 px-2 text-right font-mono'}>{bytesToString(v.memory, 1)}</td>
                                                    <td className={'py-2 px-2 text-right font-mono text-neutral-400'}>{peak(s).toFixed(0)}%</td>
                                                    <td className={'py-2 pl-2 text-right font-mono text-neutral-400 whitespace-nowrap'}>
                                                        {rate(v.rxRate + v.txRate)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    </div>
                </>
            )}
        </PageContentBlock>
    );
};
