# Photos are hotlinked, except Instagram and TikTok images, which are copied

Each Idea shows up to 8 photos, found on its own pages. The app stores their links and the browser loads them from the source with `referrerPolicy="no-referrer"`. Instagram, TikTok and Facebook CDN links expire within days. The app keeps copies of those in Postgres (`stored_photos`) and serves them at `/api/photos/:id`. We rejected copying every photo, because it grows a database on the shared cluster for links that stay valid for years. We also rejected object storage, because the app has no bucket off Cloud.

## Consequences

- A venue that changes its site can break a photo link. A photo that no longer loads is not repaired.
- Muse gets copied photos through `/api/muse/photos/:id`, which needs its token.
