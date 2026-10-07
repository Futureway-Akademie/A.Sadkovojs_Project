// Test-only resolver: lets Node load the app's TypeScript modules, which import siblings without
// file extension ("./format") as the bundler does. Used via --import in npm run test:unit.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".") || /\.[cm]?[jt]sx?$/.test(specifier)) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
