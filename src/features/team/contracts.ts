// Contract types for B8 team (BUILD_PLAN §6.8). Types only.
export interface UserBrief {
  id: string;
  name: string;
  firstName: string;
  email: string;
  phone: string | null;
  role: string;
  baseRole: "admin" | "office" | "tech";
  status: string;
  workerType: "w2" | "1099";
  color: string | null;
  avatarUrl: string | null;
  licenseNumbers: {
    state: string;
    trade: string;
    number: string;
    expiresOn: string | null;
  }[];
  usesCompanyTools: boolean;
  usesCompanyVehicle: boolean;
}
