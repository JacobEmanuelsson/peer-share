# Interactive public landing page

Approved choices: existing dark green/lime style, click-through Connect → Accept →
Send simulation with selectable group members, public /, and protected /app.

## Files and responsibilities

- pages/LandingPage.tsx composes the public hero, feature descriptions, simulation,
  connection explainer, and account-aware workspace/signup links.
- TransferPlayground.tsx owns the demo's local React state. Visitors add/select up
  to three sample recipients, connect, accept as each selected person, and send a
  fictional sample file. Every selected recipient must accept before Send appears.
  Reset/replay clears transfer state while keeping the chosen sample group.
- ConnectionExplainer.tsx switches between server-assisted setup and encrypted
  WebRTC data transfer, including the TURN-relay qualification.
- landing.css contains responsive styling, SVG connection paths, moving packets,
  focus-friendly native controls, and reduced-motion rules.

Paths above are relative to client/src except files in this directory.
No animation package, file picker, WebRTC instance, or real signaling request is
used by the demo. The public shell may check the viewer's Better Auth session to
choose an Open workspace or account-creation link. SIMULATION labels and explanatory
copy distinguish the preview from the real app.

## Routes

- /: public landing page, including for signed-in visitors.
- /app: existing sharing workspace behind SessionBoundary.
- /login and /sign-up: guest forms; signed-in visitors are redirected to /app.
- Successful login/signup replaces the route with /app.
- Signout still redirects to /login. Brand/404 home links lead to public /.
- Backend session, Origin and membership authorization is unchanged.

## Verification

npm run build checks both TypeScript workspaces and the client bundle.

Real Chrome verification covered: public access, single/multiple recipients,
deselecting recipients, no-selection prevention, per-recipient acceptance,
transfer completion and replay, mid-flow reset, keyboard activation, the
setup/transfer toggle, no real signaling/file requests, layouts at 320/390/768px,
desktop/mobile screenshots, reduced motion, protected /app, successful login/signup
redirects, signed-in visits to public /, and auth-page redirects. Temporary test
accounts and auth records were removed afterward.