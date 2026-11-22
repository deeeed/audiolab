# Audiolab project tools

Run the shared recipe command from `{{REPO}}`. `AUDIOLAB_APP` selects the domain app. Use `{{PLATFORM}}`, assigned ports and `{{ARTIFACT_DIR}}` for proof. Discover with `yarn recipe list --json`; validate with `yarn recipe:validate`. Native proof requires the slot device and a matching dev client.

Core prepare keeps proof resources off. Request `metro` and the appropriate `web.ui`, `ios.device` or `android.device` lease through Farmslot before runtime proof. Native proof then uses the `launch-app` slot action. Release leases through the declared providers.
