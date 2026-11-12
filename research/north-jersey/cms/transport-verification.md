# CMS transport checks

The coordinating agent reproduced two local transport failures on November 12, 2026 against the same public CMS metadata endpoint.

## Results

| Request | Observed result |
| --- | --- |
| `python3` with its default CA configuration | `CERTIFICATE_VERIFY_FAILED`, unable to get local issuer certificate |
| `SSL_CERT_FILE=/etc/ssl/cert.pem python3` with the default Python user agent | HTTP 200, 1,366 response bytes |
| `curl` with its default user agent | HTTP 200 |
| `curl --user-agent 'Harbor CMS public evidence collector/1.0'` | HTTP 403 |

The request URL was `https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/4pq5-n9py`.

These checks establish that this endpoint was reachable from the local shell. They do not establish why the custom user agent received a 403.

## Working verified-TLS request

```sh
SSL_CERT_FILE=/etc/ssl/cert.pem python3 -c 'import urllib.request; u="https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/4pq5-n9py"; r=urllib.request.urlopen(u, timeout=20); print(r.status, len(r.read()))'
```

No TLS verification was disabled. These observations concern the collection environment, not the clinical evidence.
