import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, useColorScheme } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

export default function App() {
  const dark = useColorScheme() === 'dark';
  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.container, { backgroundColor: dark ? '#111827' : '#fff' }]}>
        <Text style={[styles.title, { color: dark ? '#fff' : '#111827' }]}>Brain Broccoli</Text>
        <Text style={{ color: dark ? '#d1d5db' : '#4b5563' }}>
          NeuroPro2 protocol editor — skeleton only
        </Text>
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 12,
  },
});
