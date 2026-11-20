import { createApp, watch } from "vue";
import App from "./web/App.vue";
import * as I18n from "./web/i18n";
import * as Data from "./assets/data";
import {
  initConfig,
  AppConfig,
  saveUpgradedConfig,
  uiLanguage,
} from "./web/Config";
import { Host } from "./web/background/IPC";
import { initGameInfo } from "./web/background/GameInfo";
(async function () {
  await initConfig();
  const i18nPlugin = await I18n.init(uiLanguage());
  await Data.init(AppConfig().language);
  await Host.init();
  saveUpgradedConfig();
  initGameInfo();

  watch(
    () => AppConfig().language,
    async () => {
      await Data.loadForLang(AppConfig().language);
    },
  );
  watch(uiLanguage, async (lang) => {
    await I18n.loadLang(lang);
  });

  const app = createApp(App);
  app.use(i18nPlugin);
  app.mount("#app");
  if (import.meta.env.DEV) {
    app.config.performance = true;
    console.error("DEV MODE");
  }
})();
