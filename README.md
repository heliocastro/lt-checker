# LT Checker

A Chrome extension that checks grammar and spelling as you type, in the style of
Grammarly. Text is checked by **your own self-hosted
[LanguageTool](https://languagetool.org) server** instead of a third-party
service.

## Features

- Checks `<textarea>` and rich-text (`contenteditable`) fields on any page,
  including fields inside iframes. Gmail, GitHub, forums and CMS editors work.
- Underlines issues by type: red for spelling, orange for grammar and
  punctuation, blue for style.
- Click an underline to see the explanation and suggested replacements. Applying
  a replacement keeps the editor's undo history and works with React-based
  editors.
- **Add to dictionary**, **Ignore** and **Disable rule** actions.
- A badge in the corner of the field shows the issue count. Click it to recheck.
- The toolbar button turns checking off or on for the current site.
- Settings for the server URL, an optional API token, language (or
  auto-detect), preferred variants, mother tongue and picky mode.
- Code editors and fields with `spellcheck="false"` are skipped.

## Requirements

- Chrome, or another Chromium browser, version 120 or newer.
- A reachable LanguageTool HTTP server, for example the
  [`erikvl87/languagetool`](https://hub.docker.com/r/erikvl87/languagetool)
  Docker image.

## Install in Chrome (unpacked)

1. Build the extension. This needs [Vite+](https://viteplus.dev/) and pnpm.

   ```sh
   pnpm install
   pnpm run build        # output in dist/
   ```

   You can also download the `lt-checker-dist` artifact from a CI run, or the zip
   from a GitHub release, and unzip it.

2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `dist/` folder.
5. Pin **LT Checker** to the toolbar if you want quick access to the on/off
   toggle.

After rebuilding, click the reload icon on the extension card in
`chrome://extensions` and refresh the pages you are using it on.

## Configure

Right-click the toolbar icon → **Options**. Alternatively, go to
`chrome://extensions` → LT Checker → **Details** → **Extension options**.

| Setting                                               | Description                                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| LanguageTool server                                   | Base URL, e.g. `https://lt.example.info` or `http://localhost:8010`. `/v2/check` is appended. |
| API token                                             | Optional. Sent as `Authorization: Bearer <token>`.                                            |
| Language                                              | `auto` to detect, or a code such as `en-US`, `de-DE`, `pt-BR`.                                |
| Preferred variants                                    | Variants used with auto-detection, e.g. `en-US,de-DE,pt-BR`.                                  |
| Mother tongue                                         | Optional. Enables false-friend checks.                                                        |
| Picky mode                                            | Adds more style and typography suggestions.                                                   |
| Personal dictionary / Disabled rules / Disabled sites | One entry per line.                                                                           |

Click **Test** to check that the server can be reached, then click **Save**. If
you use a server other than the default, Chrome asks for permission to contact
it.

## Usage

- Click into a text field and start typing. The field is checked about one
  second after you stop.
- Click an underlined word to open the suggestion card. Press **Esc** to close
  it.
- Click the badge in the field's corner to recheck the field now.
- Click the toolbar icon to turn checking off on the current site. The icon then
  shows **OFF**. Click it again to turn checking back on.

## Server setup

### LanguageTool (Docker Compose)

```yaml
services:
  languagetool:
    image: erikvl87/languagetool:latest
    restart: always
    environment:
      - langtool_languageModel=/ngrams # optional n-gram data
      - Java_Xms=512m
      - Java_Xmx=2g
    volumes:
      - ./ngrams:/ngrams
    ports:
      - 8010:8010 # omit when a reverse proxy reaches it over a Docker network
```

The image provides only the HTTP API. There is no web UI, and requesting `/`
returns _"Missing arguments for LanguageTool API"_. That response is expected.

### Reverse proxy with token authentication (nginx)

[`deploy/lt.example.info.conf`](deploy/lt.example.info.conf) is an
example nginx config. It allows a request that has either a valid TLS client
certificate or a bearer token.

```sh
TOKEN=$(openssl rand -hex 32); echo "$TOKEN"
printf '"Bearer %s" 1;\n' "$TOKEN" | sudo tee /etc/nginx/secrets/lt-token.map
sudo chmod 600 /etc/nginx/secrets/lt-token.map
sudo nginx -t && sudo nginx -s reload

# Verify
curl -H "Authorization: Bearer $TOKEN" -d language=auto -d "text=This are a test." \
  https://lt.example.info/v2/check
```

Then paste the token into the extension's **API token** setting.

## Development

```sh
pnpm install
pnpm run check   # format, lint and type check (vp check)
pnpm run build   # build into dist/
pnpm run zip     # build and package as lt-checker.zip
```

| Path                                 | Purpose                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `src/content.ts`                     | Field detection, underlines, suggestion card and applying replacements       |
| `src/textmap.ts`                     | Maps `contenteditable` text offsets to DOM text nodes                        |
| `src/background.ts`                  | Service worker: LanguageTool API calls, dictionary and rules, toolbar toggle |
| `src/options.html`, `src/options.ts` | Options page                                                                 |
| `src/settings.ts`                    | Settings schema and storage helpers                                          |
| `public/manifest.json`               | Extension manifest (MV3); the version is set here                            |
| `deploy/`                            | Example server configuration                                                 |

Requests are sent from the background service worker, so the page's
Content Security Policy and CORS rules don't apply to them.

## GitHub workflows

| Workflow                       | Trigger                                   | Enabled by default                                            |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------------------- |
| `ci.yml`                       | Push to `main`, pull requests             | Yes. Runs check and build, and uploads `dist/` as an artifact |
| `release.yml`                  | Manual (optionally on `v*` tags)          | **No.** Needs variable `RELEASE_ENABLED=true`                 |
| `publish-chrome-web-store.yml` | Manual (optionally on published releases) | **No.** Needs variable `CWS_PUBLISH_ENABLED=true`             |

To turn on automatic triggers, uncomment the `push`/`release` blocks in the
workflow files.

### Creating a GitHub release

1. Bump `version` in `public/manifest.json` and `package.json`.
2. Set the repository variable `RELEASE_ENABLED` to `true` (**Settings → Secrets
   and variables → Actions → Variables**).
3. Go to **Actions → Release → Run workflow**. This creates the release
   `v<version>` with `lt-checker-<version>.zip` attached.

### Publishing to the Chrome Web Store

The workflow uses the
[Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/api).

1. **Register as a developer** at the
   [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
   There is a one-time fee.
2. **Upload the first version by hand.** The API can only update existing items.
   Run `pnpm run zip`, upload `lt-checker.zip` in the dashboard, and fill in the
   store listing. You need screenshots and a privacy policy, because the
   extension sends the text you type to the server you configure. Note the
   **extension ID** and your **publisher ID**.
3. **Create OAuth credentials:**
   1. In [Google Cloud Console](https://console.cloud.google.com/), enable the
      **Chrome Web Store API**.
   2. Configure the OAuth consent screen and create an OAuth client ID of type
      _Desktop app_.
   3. Get a refresh token for the scope
      `https://www.googleapis.com/auth/chromewebstore`, for example with the
      [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
      using your own client ID and secret.
4. **Configure the GitHub repository**
   (**Settings → Secrets and variables → Actions**):

   | Kind     | Name                  | Value                           |
   | -------- | --------------------- | ------------------------------- |
   | Secret   | `CWS_CLIENT_ID`       | OAuth client ID                 |
   | Secret   | `CWS_CLIENT_SECRET`   | OAuth client secret             |
   | Secret   | `CWS_REFRESH_TOKEN`   | OAuth refresh token             |
   | Variable | `CWS_PUBLISHER_ID`    | Publisher ID from the dashboard |
   | Variable | `CWS_EXTENSION_ID`    | Extension ID                    |
   | Variable | `CWS_PUBLISH_ENABLED` | `true`                          |

   The job runs in the `chrome-web-store` environment. You can add required
   reviewers to that environment so each publish needs manual approval.

5. **Run it:** go to **Actions → Publish to Chrome Web Store → Run workflow**.
   - With `publish` unchecked, the workflow only uploads a draft.
   - With `publish` checked, it submits the upload for review.
   - With `staged` checked, the approved version waits until you publish it from
     the dashboard.

**Store review notes:** the extension runs on all sites (`<all_urls>`) and has
`host_permissions` for a specific server. That combination usually triggers an
in-depth review. For a public listing, consider removing the default server URL
from `host_permissions` and `DEFAULTS.serverUrl`, so that every server is
granted through the options page.

## License

[Mozilla Public License 2.0](LICENSE) (MPL-2.0).

You can use, modify and distribute this extension, including in commercial or
closed-source products. If you distribute modified versions of these files,
including as a published browser extension, you must make the source of those
modified files available under the MPL-2.0.
