# Application pipelines recovered from Git

[Home](../../README.md)

These files are **exact copies** of historical GitHub blobs: no syntax fixes, job changes or silent rewrites. Their checksums are included in the delivery package. They restore a specific phase; they are not meant to run as three active pipelines at once.

| Supplied file | Source | Purpose |
|---|---|---|
| [phase1-local.gitlab-ci.yml](phase1-local.gitlab-ci.yml) | [1d94082 · September 13](https://github.com/Songhai9/anime-review-app/blob/1d940824086fb9b7d9a376c3fb39093a6e9d5163/.gitlab-ci.yml) | Lint, tests, coverage, single-image build/push |
| [phase2-build.gitlab-ci.yml](phase2-build.gitlab-ci.yml) | [ef6d75b · September 18](https://github.com/Songhai9/anime-review-app/blob/ef6d75b130dbd9c50a1ff79bab49c57677ff6df9/.gitlab-ci.yml) | Two targets, amd64/arm64, no deployment |
| [phase2-vm.gitlab-ci.yml](phase2-vm.gitlab-ci.yml) | [acb7c59 · September 18](https://github.com/Songhai9/anime-review-app/blob/acb7c59df071bde388a741b3eaa64aecc9f8ce8c/.gitlab-ci.yml) | Two images and infra trigger with IMAGE_TAG |

The native Ansible phase, driven from the workstation, did not depend on an application deployment trigger. The first archive represents the quality/build CI available before automated VM delivery; it is not a workstation deployment pipeline.

## Placement and activation

Keep these files under `docs/ci-history/` as documentation; placing them there **does not execute them**. To use one, select a dedicated environment/branch and either copy the chosen file to root `.gitlab-ci.yml`, or set its path as the GitLab **CI/CD configuration file**. Do not activate conflicting root configurations.

These archives use a `main` rule. On a differently named demonstration branch, they will not create a pipeline without adjustment. Any adjustment produces a new version and must remain distinct from the exact archives.

## Compatibility checks

- Phase 1: Docker build without an explicit target, producing one final image. Do not use it to feed modern manifests expecting `/backend` and `/frontend`.
- Phase 2 build: a Dockerfile with `api-runtime` and `frontend-runtime`, a DinD/privileged runner and Buildx support. `BUILDX_NO_DEFAULT_ATTESTATIONS=1` preserves the historical workaround.
- Phase 2 VM: the target project must run its **VM pipeline**, not today's Kubernetes pipeline. Ansible defines the registry prefix.
- All versions: align `main`, registry access, cross-project permissions and protected variables. Local YAML parsing can check syntax; GitLab CI Lint and actual project settings are needed to validate integration.

The application's current root `.gitlab-ci.yml` already implements the Kubernetes phase and remains its reference configuration.
