# SOP: Publish APEX Delivery Pipeline to the VS Code Marketplace

## 1. Purpose & Scope

### Business Problem Solved

Publishing the extension to the VS Code Marketplace lets users install and update the APEX Delivery Pipeline through the standard VS Code extension flow instead of manually loading a local development build.

### In Scope

- Preparing the extension manifest for Marketplace publication.
- Packaging a `.vsix` file with `@vscode/vsce`.
- Creating or using a Visual Studio Marketplace publisher.
- Publishing a public or private Marketplace extension.
- Verifying the published extension can be installed and run.

### Out of Scope

- Choosing a legal license on behalf of the owner.
- Creating paid Marketplace offers.
- Automating CI/CD release pipelines.
- Publishing Open VSX or other non-Microsoft registries.

### Target Users & Roles

| Role | Responsibility |
|---|---|
| Extension Owner | Owns Marketplace publisher, release approval, and listing metadata |
| Developer | Builds, packages, smoke-tests, and publishes the extension |
| Reviewer | Validates package contents, README, privacy/security notes, and version readiness |
| APEX Owner | Confirms business value, ROI tracking, and release learnings |

## 2. Prerequisites

### Tools, Licenses, Data Sources

- VS Code.
- Node.js and npm.
- `@vscode/vsce` installed through project dev dependencies.
- A Microsoft account with access to the Visual Studio Marketplace publisher.
- A Marketplace Personal Access Token with **Marketplace > Manage** permission.
- A real `publisher` value in `package.json`; replace `local-apex` before publishing.
- A reviewed license decision; `UNLICENSED` is acceptable for local/private use but should be changed before public distribution.
- README, icon, categories, and extension description reviewed for public users.

### Skills / Training Needed

- Basic npm workflow.
- VS Code extension manifest knowledge.
- Familiarity with semantic versioning.
- Ability to validate package contents before release.

## 3. Step-by-Step Procedure

### Step 1: Confirm Marketplace Readiness

Action: Review `package.json`, README, `.vscodeignore`, icon, license, and extension commands.

Example prompt:

```text
Review this VS Code extension for Marketplace readiness.
Check package.json metadata, publisher, license, README clarity, package contents, command titles, and security/privacy notes.
Return blockers first, then warnings, then release-ready items.
```

Expected output sample:

```markdown
## Blockers
- package.json publisher is still local-apex; replace with real Marketplace publisher id.
- license is UNLICENSED; confirm whether this is private-only or choose a public license.

## Ready
- Commands are contributed under APEX Delivery.
- README explains quick start and MCP setup.
```

Quality Checkpoint: Gate 1. Objective, target audience, metadata, and release constraints must be clear before packaging.

### Step 2: Install Dependencies

Action: Install project dependencies.

Example prompt:

```text
Prepare this extension for packaging.
Install dependencies, then report any dependency or audit issue that blocks publishing.
```

Expected command:

```pwsh
npm install
```

Expected output sample:

```text
added packages, audited packages, 0 vulnerabilities
```

Quality Checkpoint: Gate 2. Dependencies must install cleanly or known risks must be documented.

### Step 3: Compile the Extension

Action: Run TypeScript compilation.

Example prompt:

```text
Compile the VS Code extension and fix blocking TypeScript errors.
Do not change unrelated behavior.
```

Expected command:

```pwsh
npm run compile
```

Expected output sample:

```text
tsc -p ./
```

Quality Checkpoint: Gate 2. The package must not ship with compile errors.

### Step 4: Run Extension Host Smoke Test

Action: Press `F5` in VS Code and test the core commands in an Extension Development Host.

Example prompt:

```text
Create a manual smoke test checklist for this extension before Marketplace packaging.
Cover activity bar visibility, sample epic creation, spec-kit workspace generation, Copilot pack generation, MCP config creation, dashboard rendering, and phase advancement.
```

Expected output sample:

```markdown
| Scenario | Expected Result |
|---|---|
| Open APEX Delivery view | Activity-bar view appears |
| Create Sample Epic | `docs/ai-delivery/epics/APEX-1000` exists |
| Start Integrated Delivery Flow | `specs/<feature>/` and `.github/` assets are created or skipped safely |
```

Quality Checkpoint: Gate 2. User-visible workflows must be validated manually before public release.

### Step 5: Package a VSIX

Action: Build a local `.vsix` package.

Example prompt:

```text
Package this VS Code extension as a VSIX.
Confirm the generated package name and list any unexpected files included in the package.
```

Expected command:

```pwsh
npm run package
```

Expected output sample:

```text
apex-delivery-pipeline-0.2.0.vsix
```

Quality Checkpoint: Gate 2. The package must include runtime assets such as `out/`, `media/`, `templates/`, README, and package manifest, while excluding development-only files.

### Step 6: Install the VSIX Locally

Action: Install the packaged extension into VS Code and test it outside the extension host.

Example prompt:

```text
Define the local VSIX validation checklist for this extension.
Include install, reload, command palette discovery, and uninstall/rollback checks.
```

Expected command:

```pwsh
code --install-extension .\apex-delivery-pipeline-0.2.0.vsix
```

Expected output sample:

```text
Extension 'apex-delivery-pipeline-0.2.0.vsix' was successfully installed.
```

Quality Checkpoint: Gate 2. Marketplace packaging must behave the same as local development for core commands.

### Step 7: Create or Verify Publisher

Action: Create or verify the Visual Studio Marketplace publisher id.

Example prompt:

```text
Create a Marketplace publishing checklist for this extension.
Include publisher id, PAT scope, package.json fields, and release approval.
```

Expected command:

```pwsh
npx vsce login <publisher-id>
```

Expected output sample:

```text
Personal Access Token for publisher '<publisher-id>' saved.
```

Quality Checkpoint: Gate 3. Confirm the publisher, ownership, and release authority are approved before publishing.

### Step 8: Publish to Marketplace

Action: Publish the extension.

Example prompt:

```text
Prepare a release note for Marketplace version 0.2.0.
Summarize new commands, MCP support, spec-kit integration, and known limitations.
```

Expected command:

```pwsh
npm run publish -- --pat <token>
```

Alternative command after `vsce login`:

```pwsh
npm run publish
```

Expected output sample:

```text
Published <publisher-id>.apex-delivery-pipeline@0.2.0
```

Quality Checkpoint: Gate 3. Confirm the release solves the intended distribution problem and users can install it safely.

### Step 9: Post-Publish Validation

Action: Install from Marketplace and validate the listing.

Example prompt:

```text
Create post-publish validation notes for this VS Code extension.
Check install from Marketplace, README rendering, command discovery, first-run behavior, and rollback options.
```

Expected output sample:

```markdown
## Post-Publish Validation
- Marketplace listing renders correctly.
- Extension installs from VS Code Extensions view.
- APEX Delivery view appears after reload.
- Start Integrated Delivery Flow creates expected artifacts.
```

Quality Checkpoint: Gate 3. Adoption, support readiness, and rollback path must be clear.

## 4. Quality Assurance

### Gate 1: Input Quality Checklist

- Target publisher id confirmed.
- Release version confirmed.
- License decision confirmed.
- Public/private release scope confirmed.
- README and Marketplace listing target users are clear.

### Gate 2: Output Validation Checklist

- `npm install` completed.
- `npm run compile` completed.
- Extension Host smoke test completed.
- `.vsix` package created.
- VSIX installed locally and tested.
- Package contents reviewed for secrets and unnecessary files.

### Gate 3: Business Alignment Checklist

- Publishing solves a real distribution or adoption problem.
- Release owner approved the Marketplace listing.
- Support and rollback path are documented.
- ROI can be tracked through install count, active users, support issues, and user feedback.

## 5. Success Metrics

### Leading Indicators Per Release

| Metric | Target | Source |
|---|---:|---|
| Compile success | 100% | `npm run compile` |
| Smoke-test pass rate | 100% critical scenarios | Manual checklist |
| Package review blockers | 0 | VSIX inspection |
| Marketplace listing readiness | 100% required metadata | Review checklist |

### Lagging Indicators Monthly ROI

| Metric | Target | Source |
|---|---:|---|
| Installs | Baseline + growth target | Marketplace analytics |
| Activation / usage feedback | >= 70% selected pilot users | Team survey or telemetry if added later |
| Support issues from install/setup | <= 2 high-severity issues/month | Issue tracker |
| Delivery setup time saved | >= 20% | Before/after timing |

### Escalation / Rollback Threshold

Escalate or rollback if any condition is true:

- Published package fails to activate for pilot users.
- Marketplace listing exposes incorrect privacy/security claims.
- A secret or internal-only endpoint is found in packaged content.
- High-severity support issues remain unresolved for more than one business day.
- Package adoption creates more support cost than local distribution.

Rollback options:

- Unpublish the version if policy allows.
- Publish a patched version with a higher semver.
- Ask users to install a prior VSIX temporarily.
- Disable the extension locally until the issue is fixed.

## 6. Troubleshooting

| Failure Mode | Likely Cause | Fix |
|---|---|---|
| `vsce` command not found | `@vscode/vsce` not installed | Run `npm install` |
| `Couldn't detect the repository where this extension is published` | README contains a relative Markdown link, but `package.json` has no public repository URL | Replace the relative README link with plain text, add a real `repository.url`, or package with explicit `--baseContentUrl` and `--baseImagesUrl` values |
| Publish fails with publisher error | `publisher` does not match Marketplace publisher id | Update `package.json` publisher |
| Publish fails with auth error | PAT missing Marketplace Manage scope or expired | Create a new PAT and rerun `vsce login` |
| Package contains unwanted files | `.vscodeignore` is incomplete | Update `.vscodeignore`, rebuild VSIX, inspect again |
| Extension fails to activate | Compile output missing or main points to wrong file | Run `npm run compile` and confirm `out/extension.js` exists |
| Marketplace rejects metadata | README, icon, categories, or license incomplete | Fix metadata and package again |
| Users cannot find commands | Command titles or categories are unclear | Review `contributes.commands` and README Quick Start |

Escalate to a human-only release workflow for legal/license decisions, public branding decisions, security/privacy review, or any issue involving customer data.

## 7. Change Log

| Version | Date | Owner | Changes |
|---|---|---|---|
| 0.1.0 | 2026-05-01 | APEX Owner | Initial Marketplace publishing SOP |
