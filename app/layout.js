import 'mapbox-gl/dist/mapbox-gl.css';
import './globals.css';

export const metadata = {
  title: 'NYC 311 Dispatch',
  description: 'Plan simulated maintenance from NYC 311 reports with road-time crew routes, neighborhood coverage and reviewable local AI incident intake.',
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
