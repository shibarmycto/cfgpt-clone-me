export interface VirtualMacDevice {
  id: string;
  userId: string;
  macAddress: string;
  name: string;
  createdAt: string;
  linkedSipConfig?: string;
}

const devices = new Map<string, VirtualMacDevice>();

function genId(): string {
  return "vmac_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
}

function generateMacAddress(): string {
  const hexPair = () => Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, "0");
  const firstByte = (Math.floor(Math.random() * 64) * 4 + 2).toString(16).toUpperCase().padStart(2, "0");
  return `${firstByte}-${hexPair()}-${hexPair()}-${hexPair()}-${hexPair()}-${hexPair()}`;
}

export function createVirtualMac(userId: string, name: string): VirtualMacDevice {
  const id = genId();
  const device: VirtualMacDevice = {
    id,
    userId,
    macAddress: generateMacAddress(),
    name: name || "Virtual Device",
    createdAt: new Date().toISOString(),
  };
  devices.set(id, device);
  return device;
}

export function getUserDevices(userId: string): VirtualMacDevice[] {
  return Array.from(devices.values())
    .filter((d) => d.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function updateDeviceName(id: string, name: string): VirtualMacDevice | null {
  const device = devices.get(id);
  if (!device) return null;
  device.name = name;
  return device;
}

export function regenerateDeviceMac(id: string): VirtualMacDevice | null {
  const device = devices.get(id);
  if (!device) return null;
  device.macAddress = generateMacAddress();
  return device;
}

export function linkDeviceToSip(id: string, sipConfigId: string): VirtualMacDevice | null {
  const device = devices.get(id);
  if (!device) return null;
  device.linkedSipConfig = sipConfigId;
  return device;
}

export function deleteDevice(id: string, userId: string): boolean {
  const device = devices.get(id);
  if (!device || device.userId !== userId) return false;
  devices.delete(id);
  return true;
}

export function getDevice(id: string): VirtualMacDevice | null {
  return devices.get(id) || null;
}
