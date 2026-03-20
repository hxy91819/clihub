## ADDED Requirements
### Requirement: Internal AI CLI tool variants are available
The system SHALL provide internal tool variants for Codex, Gemini, and Claude as independent options.

#### Scenario: User selects internal tool
- **WHEN** the user opens the tool picker
- **THEN** `codex-internal`, `gemini-internal`, and `claude-internal` are available as selectable tools

### Requirement: Internal tools use internal package names and commands
The system SHALL map internal tools to the following package names and commands:
- `codex-internal` → package `<private-codex-package>`, command `codex-internal`
- `gemini-internal` → package `<private-gemini-package>`, command `gemini-internal`
- `claude-internal` → package `<private-claude-package>`, command `claude-internal`

#### Scenario: Internal tool install hint
- **WHEN** the system surfaces an install hint for an internal tool
- **THEN** it references the internal package name for that tool

### Requirement: Internal tools use a private npm registry for installation
The system SHALL use a private registry flag for internal tool installation commands.

#### Scenario: User installs internal tool
- **WHEN** the user chooses to install an internal tool
- **THEN** the install command includes the private npm registry flag

### Requirement: Public tools remain available
The system SHALL keep existing public tool options unchanged.

#### Scenario: User relies on public tool
- **WHEN** the user selects a public tool (e.g., codex/gemini/claude)
- **THEN** the tool behavior and package mapping remain unchanged
