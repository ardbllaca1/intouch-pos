# bartek POS

Fresh POS system workspace.

This folder is intentionally separate from the production dashboard app. It is safe to iterate here without changing the live `public/` dashboard screens or existing server routes.

Current screen:

- `index.html` - POS/Admin split login page based on the Figma reference

Design assumptions:

- `bartek` is the POS product name.
- Client logo and venue name are tenant-specific.
- POS login requires only a waiter PIN.
- Admin Panel login requires only an admin password.

Open locally by double-clicking:

```text
bartek-pos/index.html
```

The page currently has UI-only login behavior. API wiring should be added after the login flow and tenant structure are finalized.
