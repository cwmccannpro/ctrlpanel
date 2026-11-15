# Social connections

Socials connects multiple YouTube channels, Instagram professional accounts and X accounts. Each account has a renameable sidebar section and its own analytics page. The overview's **Load analytics** shows account performance and content together. Failed accounts are reported independently.

## Activate the integration

1. Run `migrations/20261011-social-connections.sql` in the project's Supabase SQL editor. It creates the social token tables if needed, adds YouTube labels, and enables RLS with browser access revoked. It is safe to rerun and contains no sample data. The same SQL is appended to `supabase-schema.sql`.
2. Add the provider credentials below to `.env` for Express and to Cloudflare Worker secrets for production. Credentials are never `VITE_` values. The existing Supabase URL, anon key and backend service-role key are also required.
3. Register the exact callback URLs in each provider console. For production use `https://ctrlpanel.cwmccann.pro/api/youtube/callback`, `/api/instagram/callback`, and `/api/x/callback`. Set `FRONTEND_URL=https://ctrlpanel.cwmccann.pro`. Open CTRLpanel on the same hostname as the callback, so its HttpOnly connection cookie can finish sign-in.
4. Restart the local server or deploy the Worker and frontend with `npm run deploy`. Local callbacks use `http://localhost:3001/api/<platform>/callback`; open the frontend at `http://localhost:5173`. Instagram may require HTTPS, so use the production site or a tunnel for that provider.
5. In Socials, open **Connection setup** and **Check setup**, then **Connect**. Repeat for every account. The owner must complete provider sign-in and consent.

`node tools/social-setup-check.mjs` performs a read-only check using local server settings. It prints credential names and storage/callback status, never credential values or account data. The UI checks the server it is running against, so local and production configuration can differ. A ready check means the required configuration and storage exist; it does not claim that provider permissions have been granted before sign-in.

## YouTube

Reuse `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; set `YOUTUBE_REDIRECT_URI`. Enable **YouTube Data API v3** and **YouTube Analytics API** in the same Google Cloud project. Include `youtube.readonly`, `yt-analytics.readonly` and `userinfo.email` on the consent screen. Add the owner's Google account as a test user if the app is in Testing. Testing grants can expire after seven days; use a suitable production consent configuration for durable connections.

Sign-in prompts for account selection and consent. Choose the Google/Brand Account that owns the channel, and repeat to connect additional channels. Reconnecting updates access without overwriting the section label. Account views, watch time and net subscribers cover the selected range. Top videos include views, watch hours, likes, comments and shares for that range. Revenue is outside the requested scopes.

Each channel also shows **Latest publications**: its 12 newest uploads, read from that channel's uploads playlist and sorted by publication time. These appear even if they are not top performers or were published outside the selected channel range. Thumbnails, titles, publication dates and links accompany lifetime views, likes, comments, watch hours, shares and average view duration. Public counts come from the Data API; one bounded Analytics report covers the recent videos' published lifetimes. Watch metrics may lag behind public counts, and missing metrics display “—”. An Analytics failure preserves available publication counts; a publication failure preserves channel analytics. The combined Socials overview previews six latest uploads for each YouTube channel. Nothing is persisted or seeded by this view.

Official references: [YouTube channel reports](https://developers.google.com/youtube/analytics/channel_reports), [Channel uploads](https://developers.google.com/youtube/v3/guides/implementation/videos), [Google web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

## Instagram

Set `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` and `INSTAGRAM_REDIRECT_URI`; optionally pin `INSTAGRAM_API_VERSION`. Use the app ID and secret from **Instagram API with Instagram Login**, rather than the top-level Meta app. A Facebook Page is not required. The account must be Business or Creator.

Grant `instagram_business_basic` and `instagram_business_manage_insights`. For your own accounts in Development mode, assign the Instagram tester role and accept the invitation in Instagram. Connecting accounts outside app roles may require Meta App Review/Advanced Access. Register the callback in Instagram login settings.

Connect each account separately. The long-lived token lasts about 60 days and refreshes on use when fewer than 20 days remain. An expired account must reconnect. Totals use the requested 7/14/28/30-day window; recent content insights are lifetime metrics. Unsupported metrics display “—”; new-follower series requires sufficient followers.

Official reference: [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/).

## X

Set `X_CLIENT_ID`, `X_CLIENT_SECRET` and `X_REDIRECT_URI`. Enable OAuth 2.0 for a **Web App** with **Read** permissions in the X Developer Console. Use the OAuth 2.0 client credentials, rather than the OAuth 1.0 API key pair. CTRLpanel requests only `tweet.read users.read offline.access`, with S256 PKCE. Tokens refresh server-side, including refresh-token rotation.

Check API access, credits and spending limits in the console. X charges API reads. CTRLpanel loads X content analytics only when requested; no polling or background content fetch occurs. Adding an account reads its profile during sign-in. Switch the active X account before connecting another if X reuses an existing login.

The 7/28-day selector filters **when posts were published**. Their impressions, likes, replies, reposts, quotes, bookmarks and available private clicks are **lifetime totals**, not engagement during that window. Reposted content is excluded. Up to three pages of 100 posts are fetched; larger/incomplete results are labelled partial. Unknown metrics remain unknown instead of becoming zero. Private metrics are limited to recent owned posts; when unavailable, public metrics still display. Rate limits, denied access and exhausted credits have actionable errors.

Official references: [OAuth 2.0 PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [Metrics](https://docs.x.com/x-api/fundamentals/metrics), [Pricing and credits](https://docs.x.com/x-api/getting-started/pricing).

## API and verification

For `youtube`, `instagram`, and `x`, both Express and Worker use `backend/socials.js`:

- `GET /api/<platform>/status`: bearer-authenticated configuration check and safe account metadata.
- `POST /api/<platform>/connect`: returns the provider URL and sets a short-lived HttpOnly, SameSite=Lax cookie. Session tokens are never included in redirect URLs.
- `GET /api/<platform>/callback`: validates signed, expiring state and the originating browser cookie; exchanges the provider code and clears the cookie. X includes PKCE.
- `GET /api/<platform>/analytics?id=&range=`: verified owner's analytics only.
- `POST /api/<platform>/rename` / `disconnect`: verified owner's account row only.

OAuth tokens and refresh tokens stay in backend-only tables. Reconnecting preserves labels and other accounts. Disconnect removes only the local connection; revoke provider grants through that provider's account settings if desired.

Run `node --test tests/socialConnections.test.mjs tests/instagram.test.mjs tests/socialPlatforms.test.mjs tests/sidebarNavigation.test.mjs` and `npm run build`. These tests mock providers and Supabase, cover owner isolation, callback binding, PKCE, token refresh, errors, content, and both route adapters. Actual live account authorization still requires the owner's provider consent.
