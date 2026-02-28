import { apiFetch } from "../../lib/api";

export type DeviceHealth = {
  id: string;
  name: string;
  status: "ONLINE" | "OFFLINE";
  secondsSinceLastSeen: number | null;
};

export async function fetchDeviceHealth(): Promise<DeviceHealth[]> {
  return apiFetch<DeviceHealth[]>("/admin/devices/health");
}