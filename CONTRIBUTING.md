# 贡献指南（Contributing）

- 使用中文撰写 Issue 与 PR 描述，包含重现步骤或截图。
- 代码需包含中文模块/函数 JSDoc 注释；涉及架构变更需更新 `docs/` 与 `README.md`。
- 提交前请确保：
  - `npm run typecheck` 通过；
  - `npm run lint && npm run test` 通过；
  - 不引入不必要的权限；
- 提交信息建议遵循约定式提交（如 feat/fix/docs/chore）。
