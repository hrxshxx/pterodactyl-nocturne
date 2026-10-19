#!/usr/bin/env node
// Applies the Nocturne theme to a Pterodactyl panel checkout.
//
//   node scripts/apply.mjs /var/www/pterodactyl
//   node scripts/apply.mjs /var/www/pterodactyl --restore
//
// Every file this touches is copied to <panel>/.nocturne-backup/ while it is
// still pristine, and every run patches from those copies, so re-running is
// safe and --restore puts the panel back exactly as it was. It does not build the
// frontend; install.sh does that.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const restore = args.includes('--restore');
const panel = path.resolve(args.find((a) => !a.startsWith('--')) || '/var/www/pterodactyl');
const backupDir = path.join(panel, '.nocturne-backup');

const TARGETS = [
    'tailwind.config.js',
    'resources/scripts/components/server/console/Console.tsx',
    'resources/views/templates/wrapper.blade.php',
    'resources/views/layouts/admin.blade.php',
    'resources/scripts/routers/DashboardRouter.tsx',
    'resources/scripts/components/NavigationBar.tsx',
];
const PUBLIC_DIR = 'public/themes/nocturne';
// New source files we add to the panel (removed again by --restore).
const COMPONENT_DIR = 'resources/scripts/components/nocturne';

const die = (msg) => {
    console.error(`nocturne: ${msg}`);
    process.exit(1);
};
const log = (msg) => console.log(`nocturne: ${msg}`);

// ---------------------------------------------------------------- checks ---

for (const rel of TARGETS) {
    if (!fs.existsSync(path.join(panel, rel)) && !fs.existsSync(path.join(backupDir, rel))) {
        die(`${rel} not found in ${panel}. Is this a Pterodactyl 1.x panel directory?`);
    }
}

let version = 'unknown';
try {
    const app = fs.readFileSync(path.join(panel, 'config/app.php'), 'utf8');
    version = (app.match(/'version'\s*=>\s*'([^']+)'/) || [])[1] || version;
} catch {}
if (!/^1\.1[1-5]\./.test(version) && version !== 'canary') {
    console.warn(`nocturne: warning: panel version is ${version}; this theme is tested on 1.11 to 1.15.`);
}

// ---------------------------------------------------------------- backup ---

const MARKER = 'pterodactyl-nocturne';
const isPatched = (rel) => {
    const file = path.join(panel, rel);
    return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(MARKER);
};
const original = (rel) => fs.readFileSync(path.join(backupDir, rel), 'utf8');
// Writes are queued and only flushed once every patch has succeeded, so a
// panel we can't patch is left exactly as it was.
const pending = [];
const write = (rel, data) => pending.push([rel, data]);
const flush = () => {
    for (const [rel, data] of pending) {
        const file = path.join(panel, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, data);
    }
};

if (restore) {
    if (!fs.existsSync(backupDir)) die(`no backup at ${backupDir}; nothing to restore.`);
    for (const rel of TARGETS) {
        const src = path.join(backupDir, rel);
        // A file without our marker was replaced by a panel update; keep it.
        if (fs.existsSync(src) && isPatched(rel)) fs.copyFileSync(src, path.join(panel, rel));
    }
    fs.rmSync(path.join(panel, PUBLIC_DIR), { recursive: true, force: true });
    fs.rmSync(path.join(panel, COMPONENT_DIR), { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
    log('restored original files. Rebuild the panel frontend to finish.');
    process.exit(0);
}

// Back up every file that isn't already ours. After a panel update the files
// are pristine again, so this also refreshes the backup to the new version.
for (const rel of TARGETS) {
    if (isPatched(rel)) continue;
    const dest = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(panel, rel), dest);
}

// ---------------------------------------------------------------- config ---

const cfg = {
    accent: '#9184d9',
    background: '#161826',
    surfaceTint: 30,
    radius: 'default',
    consoleScheme: 'nocturne',
    statsPage: true,
    ...JSON.parse(fs.readFileSync(path.join(ROOT, 'nocturne.config.json'), 'utf8')),
};
const isHex = (h) => /^#[0-9a-f]{6}$/i.test(h);
if (!isHex(cfg.accent)) die(`accent must be a 6-digit hex colour, got ${cfg.accent}`);
if (!isHex(cfg.background)) die(`background must be a 6-digit hex colour, got ${cfg.background}`);

// Same colour maths the design's Personalisation screen uses.
const hx = (h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => toHex(hx(a).map((v, i) => v + (hx(b)[i] - v) * t));
const lum = (h) => {
    const c = hx(h).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const TEXT = '#e9e9ed';
const acc = cfg.accent;
const bg = cfg.background;
const surface = mix(mix(bg, TEXT, 0.07), acc, (Math.max(0, Math.min(100, cfg.surfaceTint)) / 100) * 0.18);

const accentRamp = {
    50: mix(acc, '#ffffff', 0.94),
    100: mix(acc, '#ffffff', 0.9),
    200: mix(acc, '#ffffff', 0.78),
    300: mix(acc, '#ffffff', 0.55),
    400: mix(acc, '#ffffff', 0.3),
    500: acc,
    600: mix(acc, '#000000', 0.18),
    700: mix(acc, bg, 0.42),
    800: mix(acc, bg, 0.62),
    900: mix(acc, bg, 0.8),
    950: mix(acc, bg, 0.88),
};

// Pterodactyl paints the page with gray-800, cards with gray-700, inputs with
// gray-600 and the top bar with gray-900; the light steps are text.
const grayRamp = {
    50: '#f3f5fe',
    100: '#e4e7f5',
    200: '#cfd3e5',
    300: '#b2b6ca',
    400: '#9397ab',
    500: mix(bg, TEXT, 0.3),
    600: mix(surface, TEXT, 0.06),
    700: surface,
    800: bg,
    900: mix(bg, '#000000', 0.3),
};

const SCHEMES = {
    nocturne: { bg: '#0f1019', fg: '#d6d7e2', dim: '#5b5f72', info: '#a99ff0', ok: '#7fd1ae', warn: '#e6c37a', err: '#ef8f8f', cyan: '#8fd3e8', magenta: '#d4a5f0' },
    dracula: { bg: '#1e1f29', fg: '#f8f8f2', dim: '#6272a4', info: '#bd93f9', ok: '#50fa7b', warn: '#f1fa8c', err: '#ff5555', cyan: '#8be9fd', magenta: '#ff79c6' },
    tokyo: { bg: '#16161e', fg: '#c0caf5', dim: '#565f89', info: '#7aa2f7', ok: '#9ece6a', warn: '#e0af68', err: '#f7768e', cyan: '#7dcfff', magenta: '#bb9af7' },
};
const scheme = SCHEMES[String(cfg.consoleScheme).toLowerCase()];
if (!scheme) die(`consoleScheme must be one of ${Object.keys(SCHEMES).join(', ')}`);

const RADII = { sharp: ['2px', '4px'], default: ['8px', '14px'], rounded: ['12px', '20px'] };
const radius = RADII[String(cfg.radius).toLowerCase()];
if (!radius) die(`radius must be one of ${Object.keys(RADII).join(', ')}`);

const onAccent = ratio(acc, '#15131f') >= ratio(acc, '#f3f5fe') ? '#15131f' : '#f3f5fe';
if (ratio(acc, bg) < 3) {
    console.warn(`nocturne: warning: accent on background is ${ratio(acc, bg).toFixed(1)}:1, below the 3:1 needed for UI.`);
}

// ------------------------------------------------------- tailwind config ---

const json = (o) => JSON.stringify(o, null, 4);

write(
    'tailwind.config.js',
    `// Generated by pterodactyl-nocturne (scripts/apply.mjs). The original is in
// .nocturne-backup/tailwind.config.js; run the uninstaller to restore it.
const colors = require('tailwindcss/colors');

const gray = ${json(grayRamp)};

const accent = ${json(accentRamp)};

module.exports = {
    content: [
        './resources/scripts/**/*.{js,ts,tsx}',
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Inter"', 'system-ui', 'sans-serif'],
                header: ['"Inter"', 'system-ui', 'sans-serif'],
                mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
            },
            colors: {
                black: '${scheme.bg}',
                // "primary" and "neutral" are deprecated upstream, but still used.
                primary: accent,
                blue: accent,
                cyan: accent,
                gray: gray,
                neutral: gray,
            },
            fontSize: {
                '2xs': '0.625rem',
            },
            borderRadius: {
                DEFAULT: '${radius[0]}',
                md: '${radius[0]}',
                lg: '${radius[1]}',
            },
            transitionDuration: {
                250: '250ms',
            },
            borderColor: theme => ({
                default: theme('colors.neutral.600', 'currentColor'),
            }),
        },
    },
    plugins: [
        require('@tailwindcss/line-clamp'),
        require('@tailwindcss/forms')({
            strategy: 'class',
        }),
    ]
};
`,
);
log('generated tailwind.config.js');

// ------------------------------------------------------- console colours ---

const consoleRel = TARGETS[1];
const consoleSrc = original(consoleRel);
const themeBlock = /const theme = \{[\s\S]*?\n\};/;
if (!themeBlock.test(consoleSrc)) die(`could not find the terminal theme in ${consoleRel}; is this panel modified?`);
const bright = (c) => mix(c, '#ffffff', 0.25);
write(
    consoleRel,
    consoleSrc.replace(
        themeBlock,
        `const theme = {
    // pterodactyl-nocturne: ${String(cfg.consoleScheme).toLowerCase()} console scheme
    background: '${scheme.bg}',
    foreground: '${scheme.fg}',
    cursor: 'transparent',
    black: '${scheme.bg}',
    red: '${scheme.err}',
    green: '${scheme.ok}',
    yellow: '${scheme.warn}',
    blue: '${scheme.info}',
    magenta: '${scheme.magenta}',
    cyan: '${scheme.cyan}',
    white: '${scheme.fg}',
    brightBlack: '${scheme.dim}',
    brightRed: '${bright(scheme.err)}',
    brightGreen: '${bright(scheme.ok)}',
    brightYellow: '${bright(scheme.warn)}',
    brightBlue: '${bright(scheme.info)}',
    brightMagenta: '${bright(scheme.magenta)}',
    brightCyan: '${bright(scheme.cyan)}',
    brightWhite: '#f3f5fe',
    selection: '${acc}55',
};`,
    ),
);
log(`patched console colours (${String(cfg.consoleScheme).toLowerCase()})`);

// ------------------------------------------------------------ stylesheets ---

const tokens = `:root {
    --nocturne-bg: ${bg};
    --nocturne-bg-deep: ${grayRamp[900]};
    --nocturne-surface: ${surface};
    --nocturne-raised: ${grayRamp[600]};
    --nocturne-text: ${TEXT};
    --nocturne-muted: ${grayRamp[400]};
    --nocturne-accent: ${acc};
    --nocturne-on-accent: ${onAccent};
    --nocturne-accent-300: ${accentRamp[300]};
    --nocturne-accent-700: ${accentRamp[700]};
    --nocturne-accent-800: ${accentRamp[800]};
    --nocturne-accent-900: ${accentRamp[900]};
    --nocturne-divider: color-mix(in srgb, ${TEXT} 16%, transparent);
    --nocturne-radius: ${radius[0]};
    --nocturne-radius-lg: ${radius[1]};
    --nocturne-ok: #7fd1ae;
    --nocturne-warn: #e6c37a;
    --nocturne-danger: #ef8f8f;
}
`;
for (const name of ['nocturne.css', 'admin.css']) {
    const css = fs.readFileSync(path.join(ROOT, 'theme', name), 'utf8');
    write(`${PUBLIC_DIR}/${name}`, `/* Generated by pterodactyl-nocturne. */\n${tokens}\n${css}`);
}
log(`generated ${PUBLIC_DIR}/nocturne.css and admin.css`);

// ------------------------------------------------------------- templates ---

const FONTS =
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">';
const stamp = Date.now().toString(36);

const wrapperRel = TARGETS[2];
let wrapper = original(wrapperRel);
const headTags = `<!-- pterodactyl-nocturne -->\n        ${FONTS}\n        <link rel="stylesheet" href="/themes/nocturne/nocturne.css?v=${stamp}">`;
// 1.11 imports its fonts in a <style> block, which we replace; 1.12+ dropped
// it, so there we insert ahead of the page's own asset section.
const fontStyle = /<style>\s*@import url\('\/\/fonts\.googleapis\.com[\s\S]*?<\/style>/;
if (fontStyle.test(wrapper)) {
    wrapper = wrapper.replace(fontStyle, headTags);
} else if (wrapper.includes("@yield('assets')")) {
    wrapper = wrapper.replace("@yield('assets')", `${headTags}\n\n        @yield('assets')`);
} else if (wrapper.includes('</head>')) {
    wrapper = wrapper.replace('</head>', `    ${headTags}\n    </head>`);
} else {
    die(`could not find where to add the stylesheet in ${wrapperRel}; is this panel modified?`);
}
wrapper = wrapper
    .replace(/<meta name="theme-color" content="[^"]*">/, `<meta name="theme-color" content="${bg}">`);
write(wrapperRel, wrapper);
log('patched the panel page template');

const adminRel = TARGETS[3];
let admin = original(adminRel);
const adminTags = `<!-- pterodactyl-nocturne -->\n            ${FONTS.replace(/\n {8}/g, '\n            ')}\n            <link rel="stylesheet" href="/themes/nocturne/admin.css?v=${stamp}">`;
// Load after AdminLTE and pterodactyl.css so our rules win.
const anchor = /(\{!! Theme::css\('css\/pterodactyl\.css[^\n]*\n)/;
if (anchor.test(admin)) {
    admin = admin.replace(anchor, `$1            ${adminTags}\n`);
} else if (admin.includes('</head>')) {
    admin = admin.replace('</head>', `    ${adminTags}\n    </head>`);
} else {
    die(`could not find where to add the stylesheet in ${adminRel}; is this panel modified?`);
}
admin = admin.replace(/<meta name="theme-color" content="[^"]*">/, `<meta name="theme-color" content="${bg}">`);
write(adminRel, admin);
log('patched the admin layout');

// ------------------------------------------------------ system stats page ---

const routerRel = TARGETS[4];
const navRel = TARGETS[5];
let router = original(routerRel);
let nav = original(navRel);

if (cfg.statsPage) {
    const routerImport = "import DashboardContainer from '@/components/dashboard/DashboardContainer';";
    const routesAnchor = /\n(\s*)\{routes\.account\.map\(/;
    if (!router.includes(routerImport) || !routesAnchor.test(router)) {
        die(`could not find the dashboard routes in ${routerRel}; is this panel modified?`);
    }
    router = router
        .replace(routerImport, `${routerImport}\nimport SystemStatsContainer from '@/components/nocturne/SystemStatsContainer'; // pterodactyl-nocturne`)
        .replace(
            routesAnchor,
            (_, indent) =>
                `\n${indent}<Route path={'/stats'} exact>\n${indent}    <SystemStatsContainer />\n${indent}</Route>\n${indent}{routes.account.map(`,
        );

    const searchAnchor = /\n(\s*)<SearchContainer \/>\n/;
    if (!searchAnchor.test(nav)) die(`could not find the top bar links in ${navRel}; is this panel modified?`);
    nav = nav
        .replace(/^(import [^\n]*\n)/, `$1import { faChartLine } from '@fortawesome/free-solid-svg-icons'; // pterodactyl-nocturne\n`)
        .replace(
            searchAnchor,
            (m, indent) =>
                `${m}${indent}<Tooltip placement={'bottom'} content={'System stats'}>\n${indent}    <NavLink to={'/stats'}>\n${indent}        <FontAwesomeIcon icon={faChartLine} />\n${indent}    </NavLink>\n${indent}</Tooltip>\n`,
        );
    write(`${COMPONENT_DIR}/SystemStatsContainer.tsx`, fs.readFileSync(path.join(ROOT, 'theme/components/SystemStatsContainer.tsx'), 'utf8'));
    log('added the System stats page (/stats)');
} else {
    fs.rmSync(path.join(panel, COMPONENT_DIR), { recursive: true, force: true });
}
write(routerRel, router);
write(navRel, nav);

flush();
log('files written. Rebuild the frontend (install.sh does this) to see the theme.');
