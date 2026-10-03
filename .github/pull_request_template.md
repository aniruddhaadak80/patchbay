name: Pull request
description: Contribute a fix, a feature, or documentation to Patchbay
labels: [enhancement]
body:
  - type: markdown
    attributes:
      value: |
        Please run `npm run typecheck && npm run lint && npm run test && npm run build`
        before requesting review, and add a test that fails without your change.

  - type: textarea
    id: problem
    attributes:
      label: What does this change, and which problem does it solve?
    validations:
      required: true

  - type: textarea
    id: proof
    attributes:
      label: How did you verify it?
      description: Tests run, commands executed, endpoints exercised.
    validations:
      required: true

  - type: dropdown
    id: surfaces
    attributes:
      label: Which surfaces does this touch?
      options:
        - Web UI
        - REST API
        - MCP / agent tools
        - Persistence or migrations
        - Engine
        - Docs
        - CI
    validations:
      required: true

  - type: textarea
    id: breaking
    attributes:
      label: Breaking changes
      description: Schema, API, or manifest format changes a deployer must handle.
