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
   - Before saying a problem is fixed, confirm which specific root cause was addressed.
