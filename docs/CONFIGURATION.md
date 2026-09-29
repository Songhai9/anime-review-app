# Application configuration

[Back to README](../README.md)

## Where do the values live?

| Variable | Native local processes | Docker Compose | Ansible VMs | Kubernetes |
|---|---|---|---|---|
| `API_URL` | `.env`, `http://localhost:3001` | `http://api:3001` in Compose | Private backend IP, injected by Ansible | `http://backend:3001` in frontend Deployment |
| `FRONTEND_PORT` | `.env`, 3000 | 3000 | frontend_port variable | Default port 3000 |
| `API_PORT` | `.env`, 3001 | 3001 | backend_port variable | Default port 3001 |
| `DATABASE_HOST` | localhost | db | Private database VM IP | postgres |
| `DATABASE_PORT` | 5433 | 5432 | 5432 | 5432 |
| `DATABASE_NAME` | medias | `${DATABASE_NAME}` | anilist_db | postgres_db |
| `DATABASE_USER` | postgres | `${DATABASE_USER}` | anilist_user | postgres_user |
| `DATABASE_PASSWORD` | `.env` | Interpolated from `.env` | Ansible Vault | `postgres-secrets` Secret |
| `DATABASE_SSL` | false | false, fixed in YAML | false | false |
| `DATABASE_SEED` | true for a demo | true, fixed in YAML | false in the Docker variant | false |
| `DATABASE_URL` | Alternative to individual SQL variables | Not injected by the supplied Compose file | Not used by playbooks | Not used by manifests |
| `TEST_DATABASE_URL` | Separate test database | Defined by test Compose | Not a runtime setting | Not a runtime setting |

**Changing `.env` does not override a value hardcoded in `docker-compose.yaml`.** For example, the supplied Compose file sets `DATABASE_SEED=true`. To disable seeding in this mode, change that value in the Compose file you use.

`DATABASE_SEED=true` runs the seed through the API code. Files mounted under `/docker-entrypoint-initdb.d` are instead executed by the PostgreSQL image only when its data directory is empty. Changing `DATABASE_PASSWORD` after the volume has been initialized does not change the password of an existing SQL role.

## Secrets and tokens

- Local: only your chosen SQL password is required. This application queries AniList publicly, without a token.
- GitLab build: GitLab supplies `CI_REGISTRY`, `CI_REGISTRY_IMAGE`, `CI_REGISTRY_USER`, `CI_REGISTRY_PASSWORD` and `CI_COMMIT_SHORT_SHA`. Do not copy them into `.env`.
- VMs: a GitLab deploy token with `read_registry`, stored in Ansible Vault, authenticates image pulls on the hosts. A CI job token expires and is unsuitable for future VM restarts.
- Kubernetes: the current manifests do not define `imagePullSecrets`. A private registry requires a docker-registry Secret associated with the workloads; see the Kubernetes repository guide.
- AWS: OIDC roles are configured in the infra and K8s repositories. The application does not require a permanent AWS access key.

The supplied examples contain no real secrets. Choose separate secrets per environment and keep populated files out of Git. URL-encode reserved characters when using a SQL connection URL. For systemd EnvironmentFiles, follow systemd's syntax; a multiline secret is unsuitable for these examples.
