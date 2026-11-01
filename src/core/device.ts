import { VielightDevice } from '@liquid-brains/brainlight/lib/neuropro/index.js';

type DeviceOptions = Omit<ConstructorParameters<typeof VielightDevice>[0], 'ip'>;

export function createNeuroPro2Device(ip: string, options: DeviceOptions = {}): VielightDevice {
  const address = ip.trim();
  const octets = address.split('.');
  if (octets.length !== 4 || octets.some((octet) =>
    !/^(0|[1-9]\d{0,2})$/.test(octet) || Number(octet) > 255
  )) {
    throw new Error('Enter a valid NeuroPro2 IPv4 address.');
  }

  return new VielightDevice({ ip: address, requestTimeout: 10_000, ...options });
}
