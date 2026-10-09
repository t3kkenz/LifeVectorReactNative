import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {Buffer} from '@craftzdog/react-native-buffer';
import BackgroundTimer from 'react-native-background-timer';
import BleManager from 'react-native-ble-manager';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import logo from '../images/logo.png';
import {
  BLE_WRITE_SIZE,
  KEY_TEST_CHARACTERISTIC,
  KEY_TRANSFER_CHARACTERISTIC,
  LIFEPI_NAME_PREFIX,
  LIFEPI_SERVICE,
} from '../config/ble';
import {
  decryptSessionMessage,
  encryptSessionMessage,
  formatProtocolMessage,
  getOrCreateIdentity,
  getStoredSessionKeys,
  openSessionEnvelope,
  toByteArray,
} from '../services/secureSession';

const SCAN_SECONDS = 8;
const CONNECTION_CHECK_MS = 15000;

async function requestBluetoothPermissions() {
  if (Platform.OS !== 'android') {
    return true;
  }

  const permissions =
    Platform.Version >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const results = await PermissionsAndroid.requestMultiple(permissions);
  return permissions.every(
    permission => results[permission] === PermissionsAndroid.RESULTS.GRANTED,
  );
}

function shortDeviceId(id) {
  if (!id) {
    return '';
  }
  return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

function TrackerMark({connected}) {
  return (
    <View style={[styles.trackerMark, connected && styles.trackerMarkConnected]}>
      <View style={styles.trackerMarkCore} />
      {[0, 45, 90, 135].map(rotation => (
        <View
          key={rotation}
          style={[styles.trackerRay, {transform: [{rotate: `${rotation}deg`}]}]}
        />
      ))}
    </View>
  );
}

export default function TrackerScreen() {
  const insets = useSafeAreaInsets();
  const [bluetoothState, setBluetoothState] = useState('unknown');
  const [devices, setDevices] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const [connectionState, setConnectionState] = useState('idle');
  const [secureState, setSecureState] = useState('not connected');
  const [lastMessage, setLastMessage] = useState('Waiting for a LifePi tracker.');
  const mountedRef = useRef(true);
  const connectedRef = useRef(null);
  const identityRef = useRef(null);
  const sessionRef = useRef(null);
  const connectRef = useRef(null);

  const addPeripheral = useCallback(peripheral => {
    const name = peripheral.name || peripheral.advertising?.localName || '';
    if (!name.toLowerCase().startsWith(LIFEPI_NAME_PREFIX)) {
      return;
    }
    setDevices(current => {
      const next = new Map(current.map(device => [device.id, device]));
      next.set(peripheral.id, {...peripheral, name});
      return Array.from(next.values()).sort(
        (a, b) => (b.rssi || -100) - (a.rssi || -100),
      );
    });
  }, []);

  const sendKeyTest = useCallback(async (peripheralId, session) => {
    const encrypted = encryptSessionMessage('Pass back', session);
    await BleManager.startNotification(
      peripheralId,
      LIFEPI_SERVICE,
      KEY_TEST_CHARACTERISTIC,
    );
    await BleManager.write(
      peripheralId,
      LIFEPI_SERVICE,
      KEY_TEST_CHARACTERISTIC,
      toByteArray(
        formatProtocolMessage(encrypted, identityRef.current.deviceId),
      ),
      BLE_WRITE_SIZE,
    );
  }, []);

  const beginSecureSession = useCallback(async peripheralId => {
    setSecureState('negotiating');
    await BleManager.startNotification(
      peripheralId,
      LIFEPI_SERVICE,
      KEY_TRANSFER_CHARACTERISTIC,
    );
    await BleManager.write(
      peripheralId,
      LIFEPI_SERVICE,
      KEY_TRANSFER_CHARACTERISTIC,
      toByteArray(
        formatProtocolMessage(
          identityRef.current.publicKey,
          identityRef.current.deviceId,
        ),
      ),
      BLE_WRITE_SIZE,
    );
  }, []);

  const disconnect = useCallback(async () => {
    const peripheralId = connectedRef.current?.id;
    if (!peripheralId) {
      return;
    }
    try {
      await BleManager.disconnect(peripheralId);
    } finally {
      connectedRef.current = null;
      if (mountedRef.current) {
        setConnectedDevice(null);
        setConnectionState('idle');
        setSecureState('not connected');
        setLastMessage('Tracker disconnected.');
      }
    }
  }, []);

  const connect = useCallback(
    async peripheral => {
      if (connectionState === 'connecting') {
        return;
      }
      setConnectionState('connecting');
      setLastMessage(`Connecting to ${peripheral.name || 'LifePi'}…`);
      try {
        await BleManager.stopScan().catch(() => undefined);
        setIsScanning(false);
        await BleManager.connect(peripheral.id);
        await BleManager.retrieveServices(peripheral.id);
        connectedRef.current = peripheral;
        setConnectedDevice(peripheral);
        setConnectionState('connected');
        setLastMessage('Bluetooth link established. Securing the session…');
        await beginSecureSession(peripheral.id);
      } catch (error) {
        await BleManager.disconnect(peripheral.id).catch(() => undefined);
        connectedRef.current = null;
        setConnectedDevice(null);
        setConnectionState('error');
        setSecureState('not connected');
        setLastMessage(error?.message || String(error));
      }
    },
    [beginSecureSession, connectionState],
  );

  connectRef.current = connect;

  const startScan = useCallback(async () => {
    if (isScanning || connectedRef.current) {
      return;
    }
    const granted = await requestBluetoothPermissions();
    if (!granted) {
      Alert.alert(
        'Bluetooth access is required',
        'LifeVector uses Bluetooth to find and connect to your LifePi tracker.',
      );
      return;
    }
    setDevices([]);
    setIsScanning(true);
    setConnectionState('scanning');
    setLastMessage('Searching nearby for LifePi trackers…');
    try {
      await BleManager.scan({
        serviceUUIDs: [],
        seconds: SCAN_SECONDS,
        allowDuplicates: false,
      });
    } catch (error) {
      setIsScanning(false);
      setConnectionState('error');
      setLastMessage(error?.message || String(error));
    }
  }, [isScanning]);

  useEffect(() => {
    mountedRef.current = true;
    let backgroundTimerId;
    const subscriptions = [
      BleManager.onDiscoverPeripheral(addPeripheral),
      BleManager.onStopScan(() => {
        if (mountedRef.current) {
          setIsScanning(false);
          setConnectionState(current =>
            current === 'scanning' ? 'idle' : current,
          );
          setLastMessage(current =>
            current.includes('Searching')
              ? 'Scan complete. Select a LifePi tracker to connect.'
              : current,
          );
        }
      }),
      BleManager.onDidUpdateState(({state}) => setBluetoothState(state)),
      BleManager.onDisconnectPeripheral(({peripheral}) => {
        if (peripheral === connectedRef.current?.id) {
          connectedRef.current = null;
          setConnectedDevice(null);
          setConnectionState('idle');
          setSecureState('not connected');
          setLastMessage('The LifePi connection ended. Ready to reconnect.');
        }
      }),
      BleManager.onDidUpdateValueForCharacteristic(async event => {
        if (event.peripheral !== connectedRef.current?.id) {
          return;
        }
        try {
          if (
            event.characteristic.toUpperCase() ===
            KEY_TRANSFER_CHARACTERISTIC
          ) {
            const responseText = Buffer.from(event.value).toString('utf8');
            const session = responseText.includes('already logged in')
              ? await getStoredSessionKeys()
              : await openSessionEnvelope(
                  event.value,
                  identityRef.current.privateKey,
                );
            if (!session) {
              throw new Error('The saved secure session is unavailable.');
            }
            sessionRef.current = session;
            await sendKeyTest(event.peripheral, session);
            setLastMessage('Secure keys accepted. Verifying the data channel…');
          } else if (
            event.characteristic.toUpperCase() === KEY_TEST_CHARACTERISTIC &&
            sessionRef.current
          ) {
            decryptSessionMessage(event.value, sessionRef.current);
            setSecureState('secured');
            setLastMessage('Secure data channel ready. Tracking is active.');
          }
        } catch (error) {
          setSecureState('error');
          setLastMessage(error?.message || String(error));
        }
      }),
    ];

    async function initialize() {
      try {
        await BleManager.start({showAlert: false});
        identityRef.current = await getOrCreateIdentity();
        const state = await BleManager.checkState();
        setBluetoothState(state);

        const connected = await BleManager.getConnectedPeripherals([]);
        const lifePi = connected.find(device =>
          (device.name || '').toLowerCase().startsWith(LIFEPI_NAME_PREFIX),
        );
        if (lifePi) {
          await connectRef.current?.(lifePi);
        }
      } catch (error) {
        setConnectionState('error');
        setLastMessage(error?.message || String(error));
      }
    }

    initialize();
    backgroundTimerId = BackgroundTimer.setInterval(async () => {
      const current = connectedRef.current;
      if (!current) {
        return;
      }
      try {
        const stillConnected = await BleManager.isPeripheralConnected(
          current.id,
          [],
        );
        if (!stillConnected && mountedRef.current) {
          connectedRef.current = null;
          setConnectedDevice(null);
          setConnectionState('idle');
          setSecureState('not connected');
          setLastMessage('Tracker moved out of range. Scan to reconnect.');
        }
      } catch {
        // The disconnect event supplies the actionable state on supported devices.
      }
    }, CONNECTION_CHECK_MS);

    return () => {
      mountedRef.current = false;
      subscriptions.forEach(subscription => subscription.remove());
      if (backgroundTimerId) {
        BackgroundTimer.clearInterval(backgroundTimerId);
      }
      BleManager.stopScan().catch(() => undefined);
    };
  }, [addPeripheral, sendKeyTest]);

  const status = useMemo(() => {
    if (secureState === 'error') {
      return {label: 'Secure link error', tone: 'error'};
    }
    if (connectionState === 'connected' && secureState === 'secured') {
      return {label: 'Tracking', tone: 'live'};
    }
    if (connectionState === 'connected') {
      return {label: 'Securing', tone: 'working'};
    }
    if (connectionState === 'connecting') {
      return {label: 'Connecting', tone: 'working'};
    }
    if (isScanning) {
      return {label: 'Scanning', tone: 'working'};
    }
    return {label: 'Ready', tone: 'quiet'};
  }, [connectionState, isScanning, secureState]);

  return (
    <View style={[styles.screen, {paddingTop: insets.top}]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {paddingBottom: Math.max(insets.bottom, 20) + 12},
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <Image source={logo} style={styles.logo} resizeMode="contain" />
            <Text style={styles.brandName}>LifeVector</Text>
          </View>
          <View style={styles.bluetoothPill}>
            <View
              style={[
                styles.bluetoothDot,
                bluetoothState === 'on' && styles.bluetoothDotOn,
              ]}
            />
            <Text style={styles.bluetoothText}>Bluetooth {bluetoothState}</Text>
          </View>
        </View>

        <Text style={styles.eyebrow}>LIFEPI TRACKER</Text>
        <Text style={styles.title}>
          Keep your day{`\n`}
          <Text style={styles.titleItalic}>in your hands.</Text>
        </Text>
        <Text style={styles.intro}>
          Connect securely to your LifePi and collect your location history on
          your own device.
        </Text>

        <View style={styles.trackerCard}>
          <View style={styles.trackerTopRow}>
            <TrackerMark connected={status.tone === 'live'} />
            <View style={[styles.statusPill, styles[`status_${status.tone}`]]}>
              {status.tone === 'working' && (
                <ActivityIndicator size="small" color="#191a18" />
              )}
              <Text
                style={[
                  styles.statusText,
                  status.tone !== 'quiet' && styles.statusTextDark,
                ]}>
                {status.label}
              </Text>
            </View>
          </View>
          <Text style={styles.cardLabel}>CURRENT TRACKER</Text>
          <Text style={styles.deviceName}>
            {connectedDevice?.name || 'No LifePi connected'}
          </Text>
          <Text style={styles.deviceDetail}>
            {connectedDevice
              ? shortDeviceId(connectedDevice.id)
              : 'Scan nearby devices to begin tracking.'}
          </Text>
          <View style={styles.divider} />
          <View style={styles.messageRow}>
            <View style={styles.messageLine} />
            <Text style={styles.message}>{lastMessage}</Text>
          </View>
          {connectedDevice ? (
            <Pressable
              accessibilityRole="button"
              onPress={disconnect}
              style={({pressed}) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
              ]}>
              <Text style={styles.primaryButtonText}>Disconnect tracker</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              disabled={isScanning || bluetoothState === 'off'}
              onPress={startScan}
              style={({pressed}) => [
                styles.primaryButton,
                (isScanning || bluetoothState === 'off') &&
                  styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}>
              <Text style={styles.primaryButtonText}>
                {isScanning ? 'Scanning…' : 'Scan for LifePi'}
              </Text>
            </Pressable>
          )}
        </View>

        {!connectedDevice && devices.length > 0 && (
          <View style={styles.deviceSection}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>Nearby trackers</Text>
              <Text style={styles.sectionCount}>{devices.length} found</Text>
            </View>
            {devices.map(device => (
              <Pressable
                accessibilityRole="button"
                disabled={connectionState === 'connecting'}
                key={device.id}
                onPress={() => connect(device)}
                style={({pressed}) => [
                  styles.deviceRow,
                  pressed && styles.deviceRowPressed,
                ]}>
                <View style={styles.deviceIcon}>
                  <View style={styles.deviceIconCore} />
                </View>
                <View style={styles.deviceCopy}>
                  <Text style={styles.deviceRowName}>{device.name}</Text>
                  <Text style={styles.deviceRowId}>{shortDeviceId(device.id)}</Text>
                </View>
                <View>
                  <Text style={styles.signalText}>{device.rssi ?? '—'} dBm</Text>
                  <Text style={styles.connectText}>Connect →</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.privacyCard}>
          <Text style={styles.privacyIcon}>⌁</Text>
          <View style={styles.privacyCopy}>
            <Text style={styles.privacyTitle}>Private by design</Text>
            <Text style={styles.privacyText}>
              Keys and tracker data remain on this device. LifeVector uses an
              encrypted Bluetooth session for every collection.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#f2f0e9'},
  content: {paddingHorizontal: 22, paddingTop: 14},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 46,
  },
  brand: {flexDirection: 'row', alignItems: 'center', gap: 9},
  logo: {width: 28, height: 28, tintColor: '#191a18'},
  brandName: {fontFamily: 'serif', fontSize: 21, color: '#191a18'},
  bluetoothPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: '#dedbd1',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  bluetoothDot: {width: 6, height: 6, borderRadius: 3, backgroundColor: '#aaa897'},
  bluetoothDotOn: {backgroundColor: '#8fca4f'},
  bluetoothText: {fontSize: 10, color: '#74766f', textTransform: 'capitalize'},
  eyebrow: {
    color: '#74766f',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2.1,
    marginBottom: 15,
  },
  title: {
    color: '#191a18',
    fontSize: 46,
    fontWeight: '500',
    letterSpacing: -2.7,
    lineHeight: 45,
  },
  titleItalic: {fontFamily: 'serif', fontStyle: 'italic', fontWeight: '400'},
  intro: {
    color: '#74766f',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 19,
    marginBottom: 27,
    maxWidth: 340,
  },
  trackerCard: {
    backgroundColor: '#171916',
    borderRadius: 22,
    padding: 22,
    shadowColor: '#25241e',
    shadowOffset: {width: 0, height: 16},
    shadowOpacity: 0.08,
    shadowRadius: 32,
    elevation: 3,
  },
  trackerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
  },
  trackerMark: {width: 40, height: 40, position: 'relative'},
  trackerMarkConnected: {transform: [{rotate: '22deg'}]},
  trackerMarkCore: {
    position: 'absolute',
    top: 15,
    left: 15,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#fbfaf6',
    zIndex: 2,
  },
  trackerRay: {
    position: 'absolute',
    top: 18,
    left: 1,
    width: 38,
    height: 4,
    borderRadius: 3,
    backgroundColor: '#a8df65',
  },
  statusPill: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
  },
  status_live: {backgroundColor: '#a8df65'},
  status_working: {backgroundColor: '#e9e6db'},
  status_error: {backgroundColor: '#e15980'},
  status_quiet: {backgroundColor: '#292b27'},
  statusText: {color: '#f7f6f1', fontSize: 11, fontWeight: '600'},
  statusTextDark: {color: '#191a18'},
  cardLabel: {
    color: '#858880',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.6,
  },
  deviceName: {
    color: '#f8f7f1',
    fontSize: 25,
    fontWeight: '500',
    letterSpacing: -0.8,
    marginTop: 8,
  },
  deviceDetail: {color: '#858880', fontSize: 11, marginTop: 7},
  divider: {height: 1, backgroundColor: '#31342e', marginVertical: 20},
  messageRow: {flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20},
  messageLine: {
    width: 3,
    height: 32,
    borderRadius: 2,
    backgroundColor: '#a8df65',
    marginRight: 11,
  },
  message: {flex: 1, color: '#aeb1aa', fontSize: 11, lineHeight: 17},
  primaryButton: {
    minHeight: 49,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: '#f7f5ee',
  },
  primaryButtonText: {color: '#191a18', fontSize: 13, fontWeight: '600'},
  buttonDisabled: {opacity: 0.45},
  buttonPressed: {opacity: 0.8, transform: [{scale: 0.995}]},
  deviceSection: {marginTop: 30},
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {fontSize: 16, fontWeight: '600', color: '#191a18'},
  sectionCount: {fontSize: 10, color: '#74766f'},
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dedbd1',
    borderRadius: 15,
    backgroundColor: '#fbfaf6',
    padding: 15,
    marginBottom: 9,
  },
  deviceRowPressed: {backgroundColor: '#eeece4'},
  deviceIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#e7f3d8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceIconCore: {width: 9, height: 9, borderRadius: 5, backgroundColor: '#191a18'},
  deviceCopy: {flex: 1, minWidth: 0, marginHorizontal: 12},
  deviceRowName: {color: '#191a18', fontSize: 13, fontWeight: '600'},
  deviceRowId: {color: '#a4a69e', fontSize: 9, marginTop: 4},
  signalText: {color: '#74766f', fontSize: 9, textAlign: 'right'},
  connectText: {color: '#191a18', fontSize: 10, fontWeight: '600', marginTop: 5},
  privacyCard: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#dedbd1',
    borderRadius: 16,
    padding: 17,
    marginTop: 18,
  },
  privacyIcon: {fontSize: 25, color: '#191a18', marginRight: 13, marginTop: -3},
  privacyCopy: {flex: 1},
  privacyTitle: {color: '#191a18', fontSize: 12, fontWeight: '600'},
  privacyText: {color: '#74766f', fontSize: 10, lineHeight: 16, marginTop: 5},
});
