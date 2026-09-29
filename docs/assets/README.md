# Architecture diagrams

The READMEs embed PNGs exported and visually checked in Figma (2400 × 1500). Standalone SVGs provide vector rendering. Keep these files together to preserve relative links.

| View | PNG | SVG |
|---|---|---|
| Local | [PNG](01-local.png) | [SVG](01-local.svg) |
| AWS VMs | [PNG](02-vm.png) | [SVG](02-vm.svg) |
| Kubernetes | [PNG](03-kubernetes.png) | [SVG](03-kubernetes.svg) |
| CI/CD | [PNG](04-cicd.png) | [SVG](04-cicd.svg) |

[Open the Figma version](https://www.figma.com/design/knfzCf5pmhG86nnKwkMccA).

Arrows show which side initiates an exchange; responses are omitted. These are logical views, not captures of running resources. The VM illustration covers both variants: native Node and frontend/API containers, with a native database. In the Kubernetes view, the “Bastion / NAT” card groups two separate public-subnet resources; the control plane is in the private subnet.

Logos from [Devicon](https://github.com/devicons/devicon), with the [license included](DEVICON-LICENSE.txt). Trademarks belong to their respective owners. Shapes and composition were created for this project.
