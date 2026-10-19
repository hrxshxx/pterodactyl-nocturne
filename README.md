# Pterodactyl Nocturne

A dark, quiet reskin for an existing [Pterodactyl](https://pterodactyl.io) panel (1.11 through 1.15), based on the Nocturne design system: a blue-grey ground, Inter at medium weight, soft 8px corners, and a blurple accent used as a line and a glow rather than a flood.

It's cosmetic only. Nothing about how the panel works changes, no database migrations, no new routes, and it can be removed with one command.

![Admin area](docs/admin.png)

## What changes

| Area | Change |
| --- | --- |
| Client panel | The whole Tailwind palette is swapped for Nocturne's: page, cards, inputs and the top bar move to the blue-grey ramp, and every blue/cyan accent becomes the Nocturne accent. Inter replaces IBM Plex/Rubik, JetBrains Mono is used for code and the console. The page gets a faint accent glow, and server rows get a hairline edge with an accent glow on hover. |
| Login | The white login card becomes a dark surface with dark inputs. |
| Console | xterm gets a matching colour scheme (Nocturne, Dracula or Tokyo Night). |
| Admin area | AdminLTE is reskinned with a dark sidebar, surface boxes, outlined buttons, dark forms, select2 and tables. |

## Install

On the panel host, as root:

```bash
git clone https://github.com/hrxshxx/pterodactyl-nocturne.git /opt/pterodactyl-nocturne
cd /opt/pterodactyl-nocturne
./install.sh /var/www/pterodactyl
```

Then hard-refresh the panel (Ctrl/Cmd+Shift+R).

The installer needs **Node.js 16 or newer** (it installs `yarn` for you if it's missing). On Debian/Ubuntu you can get Node with:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
```

The build runs webpack, which wants about 2 GB of RAM. On a small VPS, add swap first. The panel stays online during the build because the new bundle only takes over once it's finished.

### What the installer touches

It backs up and patches four files, then rebuilds the frontend:

- `tailwind.config.js`: regenerated with the Nocturne palette, fonts and radii
- `resources/scripts/components/server/console/Console.tsx`: the terminal colour block only
- `resources/views/templates/wrapper.blade.php`: fonts and `/themes/nocturne/nocturne.css`
- `resources/views/layouts/admin.blade.php`: fonts and `/themes/nocturne/admin.css`

Pristine copies go in `<panel>/.nocturne-backup/`, and the stylesheets go in `<panel>/public/themes/nocturne/`.

## Customise

Edit `nocturne.config.json`, then run `./install.sh` again:

```json
{
    "accent": "#9184d9",
    "background": "#161826",
    "surfaceTint": 30,
    "radius": "default",
    "consoleScheme": "nocturne"
}
```

| Key | Values |
| --- | --- |
| `accent` | Any 6-digit hex. The full ramp is derived from it, and the installer warns if it's below 3:1 contrast on the background. Presets from the design: Violet `#8b5cf6`, Indigo `#6366f1`, Fuchsia `#d946ef`, Cyan `#22d3ee`, Emerald `#34d399`. |
| `background` | Page colour (6-digit hex). Cards, inputs and the top bar are derived from it. |
| `surfaceTint` | 0–100. How much of the accent tints the card surfaces. |
| `radius` | `sharp`, `default` or `rounded` |
| `consoleScheme` | `nocturne`, `dracula` or `tokyo` |

## Updating Pterodactyl

A panel upgrade overwrites the patched files, so the panel goes back to its stock look. Run `./install.sh` again afterwards. It notices the new upstream files, refreshes its backups from them, and re-applies the theme.

## Uninstall

```bash
cd /opt/pterodactyl-nocturne
./uninstall.sh /var/www/pterodactyl
```

This restores the original files from `.nocturne-backup/`, deletes `public/themes/nocturne/`, and rebuilds.

## Notes

- Built and tested against Pterodactyl **v1.11.11** and **v1.15.1**. The installer warns on other versions. If a file it patches doesn't look like upstream, it stops before writing anything.
- The design mockup in [`design/`](design/) also sketches a left sidebar layout, a node "System stats" page, a container console with an audit log, and a per-user Personalisation screen. Those are new panel features rather than a reskin, so this theme doesn't include them. The Personalisation choices are available install-wide through `nocturne.config.json`.
- Panel selectors that target upstream components use the readable part of styled-components class names (for example `ServerRow__StatusIndicatorBox-`), which upstream's build keeps. If a future panel version renames a component, that one tweak stops applying, but the palette still works.
