# Security Policy

## Reporting a Vulnerability

Please report security issues privately before public disclosure.

Recommended channel:
- Open a private security advisory in the GitHub repository.

Include:
- affected command/doc flow,
- reproduction steps,
- impact assessment,
- suggested mitigation if available.

## Security Baseline

- Do not commit secrets, seed phrases, private keys, or tokens.
- Keep bot credentials in dedicated secret stores.
- Treat wallet and signing procedures as high-risk operations.
- Re-run `clawnera-help validate --strict` after major doc updates.
