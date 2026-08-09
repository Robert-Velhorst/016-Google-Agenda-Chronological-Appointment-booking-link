# HAI read-only connector

The booking service exposes a cursor-based, owner-scoped read-only feed. HAI's existing `json-feed` connector does not send authorization headers, so the small companion proxy adds the bearer token without putting secrets in a URL or HAI database.

Start it with the main stack:

```powershell
docker compose -f docker-compose.yml -f integrations/hai/docker-compose.hai.yml up -d --build
```

In HAI, create a `json-feed` connector whose sync target is `http://hai-connector:8790/feed`, and allowlist the `hai-connector` hostname. Keep both services on the same private Docker network. The feed authority is `read_only`; it contains booking metadata but never management tokens, OAuth tokens, or operator credentials. Requester names and email addresses are excluded by default. Set `HAI_CONNECTOR_INCLUDE_PII=true` only after an explicit privacy decision requires that data in HAI.
