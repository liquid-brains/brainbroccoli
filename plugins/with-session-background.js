const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

module.exports = function withSessionBackground(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    AndroidConfig.Permissions.ensurePermissions(manifest, [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
      'android.permission.CHANGE_WIFI_STATE',
      'android.permission.WAKE_LOCK',
    ]);
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    application.service ??= [];
    const serviceName = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
    let service = application.service.find((entry) => entry.$['android:name'] === serviceName);
    if (service === undefined) {
      service = { $: { 'android:name': serviceName } };
      application.service.push(service);
    }
    service.$['android:foregroundServiceType'] = 'connectedDevice';
    service.$['android:exported'] = 'false';
    return config;
  });
};
