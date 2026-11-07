# Contributing

Thank you for your interest in contributing to the AgentCore XRPL Payments
Demo.

## Development workflow

1. Create a branch from the current default branch.
2. Install the repository-pinned dependencies:

   ```bash
   bun install --frozen-lockfile
   ```

3. Make a focused change and update the relevant documentation.
4. Run the required validation:

   ```bash
   bun run verify
   ```

5. Open a pull request that explains the customer benefit, design choices,
   security impact, and test evidence.

Do not commit wallet seeds, credentials, account identifiers, deployment URLs,
transaction details, customer data, or generated CDK output. Use test networks
and synthetic data for payment demonstrations.

## Security issues

Do not open a public issue for a potential vulnerability. Follow
[SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
MIT-0 License.
