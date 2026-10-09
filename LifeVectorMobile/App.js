import React from 'react';
import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import TrackerScreen from './src/components/TrackerScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#f2f0e9" />
      <TrackerScreen />
    </SafeAreaProvider>
  );
}
