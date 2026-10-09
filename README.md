# LifeVector

LifeVector is a personal location tracker that helps people understand where their time goes. The project has two complementary interfaces:

- **LifeVector Mobile** discovers a nearby LifePi tracker over Bluetooth and securely collects its location records.
- **LifeVector Dashboard** turns those records into a clear view of daily rhythm, time by place, recurring patterns, and recent sessions.

## Browser dashboard

The dashboard is a dependency-free web application in [`dashboard/`](dashboard/). It includes responsive desktop and mobile layouts, 7/14/30-day ranges, place filters, JSON import and download, and sample data for trying the interface without a tracker.

Run it locally with any static file server:

```bash
cd dashboard
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

### Import format

Imported files stay in the browser and use this shape. Durations are expressed in minutes.

```json
{
  "places": [
    { "name": "Home", "color": "#a8df65" },
    { "name": "Gym", "color": "#d99aa5" }
  ],
  "days": [
    {
      "date": "2026-10-09",
      "places": {
        "Home": 510,
        "Gym": 65
      }
    }
  ]
}
```

The `places` array is optional. When it is omitted, the dashboard assigns colors to every place found under `days`.

The dashboard can also be fed directly from another browser application:

```js
window.LifeVectorDashboard.load(data);
```

## Mobile tracker

The original React Native application lives in [`LifeVectorMobile/`](LifeVectorMobile/). It targets Android API 28 and uses Bluetooth Low Energy to discover LifePi devices, establish an encrypted exchange, and collect tracker data in the background.

The mobile client is a legacy React Native 0.59 project. To run it, install the Android API 28 SDK and the JavaScript dependencies from `LifeVectorMobile`, then link the native dependencies and start the Android build:

```bash
cd LifeVectorMobile
npm install
npx react-native link
npx react-native run-android
```

The LifePi service must be available for Bluetooth discovery and live collection.

## Original mobile UI

### Login

![LifeVector login](lv-login.jpg)

### Time by place

![LifeVector time by place graph](lv_graph.png)

((Project))
