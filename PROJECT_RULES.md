# Project Rules

1. Do not claim a feature or effect is achievable unless it can be delivered reliably in the user's actual usage path. If something cannot be done, say so directly, explain the practical upper bound, and give alternatives.

2. Do not modify user data without explicit permission from the user.
   User data includes, but is not limited to:
   - information the user saved personally
   - information edited in the merchant backend
   - configuration or records managed in the super-admin backend

3. When a change could affect existing user data, stop first and get the user's approval before making the change.

4. For any issue, always investigate and identify the root cause first before changing code, behavior, configuration, or data.
   - Do not guess and patch blindly.
   - Do not touch logic or features that are already working successfully unless the root-cause analysis proves they are part of the problem.
   - If an existing successful logic path might be affected, stop first, explain the risk clearly, and get the user's approval before changing it.

5. Default to no-maintenance releases (user instruction, 2026-09-23).
   - Build and validate a separate candidate while the existing application remains online; switch traffic only after checks pass.
   - Keep an ownership-checked rollback target, preserve old immutable assets and existing background workers, and verify public routes after switching.
   - Database changes must be additive/backward-compatible for online publication. Do not enable maintenance, bypass release guards, clear release state, or perform destructive cleanup automatically.
   - If a change cannot safely follow this policy, explain the incompatibility and obtain approval for an alternative before affecting production.
   - Before saying a problem is fixed, confirm which specific root cause was addressed.
