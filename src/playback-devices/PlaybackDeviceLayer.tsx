import { DevicePicker, PermanentDeviceButton } from './DevicePicker';
import { PlaybackRemote } from './PlaybackRemote';

export function PlaybackDeviceLayer() {
  return <><PermanentDeviceButton/><DevicePicker/><PlaybackRemote/></>;
}
