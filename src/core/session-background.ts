import { Platform } from 'react-native';

// On Android a foreground service keeps the process, network and CPU alive when the screen is locked.
export async function runWithSessionBackground(operation: () => Promise<void>): Promise<void> {
  if (Platform.OS !== 'android') {
    await operation();
    return;
  }
  const { default: background } = await import('react-native-background-actions');
  try {
    await new Promise<void>((resolve, reject) => {
      void background
        .start(
          async () => {
            try {
              await operation();
              resolve();
            } catch (error) {
              reject(error);
            }
          },
          {
            taskName: 'BrainBroccoliSession',
            taskTitle: 'Brain Broccoli',
            taskDesc: 'Keeping your protocol running in the background.',
            taskIcon: { name: 'ic_launcher', type: 'mipmap' },
            foregroundServiceType: ['connectedDevice'],
          },
        )
        .catch(reject);
    });
  } finally {
    await background.stop();
  }
}
