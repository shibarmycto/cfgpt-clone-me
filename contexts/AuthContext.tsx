import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AppUser,
  getCurrentUser,
  setCurrentUser,
  getUserByEmail,
  saveUser,
  getUsers,
  deleteUser as removeUser,
  generateId,
  initializeApp,
  getFreeTrialLimit,
} from "@/lib/storage-helpers";
import { getApiUrl, apiRequest } from "@/lib/query-client";

const GUEST_KEY = "@cfgpt_guest_user";
const GUEST_CHAT_COUNT_KEY = "@cfgpt_guest_chat_count";
const GUEST_CHAT_LIMIT = 5;

function createGuestUser(): AppUser {
  return {
    id: `guest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    email: "",
    password: "",
    name: "Guest",
    role: "user",
    credits: 0,
    voiceCredits: 0,
    hasPaidViaPaypal: false,
    blocked: false,
    createdAt: new Date().toISOString(),
    freeTrialMessages: GUEST_CHAT_LIMIT,
    usedMessages: 0,
    freePhotoGenerations: 0,
    usedPhotoGenerations: 0,
    freeVideoGenerations: 0,
    usedVideoGenerations: 0,
  };
}

interface AuthContextValue {
  user: AppUser | null;
  isGuest: boolean;
  isLoading: boolean;
  guestChatsRemaining: number;
  login: (email: string, password: string) => Promise<string | null>;
  register: (
    email: string,
    password: string,
    name: string
  ) => Promise<string | null>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUser: (user: AppUser) => Promise<void>;
  getAllUsers: () => Promise<AppUser[]>;
  deleteUser: (userId: string) => Promise<void>;
  incrementGuestChats: () => Promise<number>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [guestChatsUsed, setGuestChatsUsed] = useState(0);

  useEffect(() => {
    (async () => {
      await initializeApp();

      try {
        const users = await getUsers();
        const superAdmin = users.find((u) => u.email === "smmasolutionsltd@gmail.com");
        if (superAdmin) {
          await apiRequest("POST", "/api/auth/sync", superAdmin).catch(() => {});
        }
      } catch {}

      const stored = await getCurrentUser();
      if (stored) {
        const fresh = await getUserByEmail(stored.email);
        if (fresh && !fresh.blocked) {
          setUser(fresh);
          setIsGuest(false);
          await setCurrentUser(fresh);
          setIsLoading(false);
          return;
        } else {
          await setCurrentUser(null);
        }
      }

      let guestJson = await AsyncStorage.getItem(GUEST_KEY);
      let guest: AppUser;
      if (guestJson) {
        guest = JSON.parse(guestJson);
      } else {
        guest = createGuestUser();
        await AsyncStorage.setItem(GUEST_KEY, JSON.stringify(guest));
      }

      const countStr = await AsyncStorage.getItem(GUEST_CHAT_COUNT_KEY);
      const count = countStr ? parseInt(countStr, 10) : 0;
      setGuestChatsUsed(count);
      guest.usedMessages = count;

      setUser(guest);
      setIsGuest(true);
      setIsLoading(false);
    })();
  }, []);

  const login = async (
    email: string,
    password: string
  ): Promise<string | null> => {
    try {
      const res = await apiRequest("POST", "/api/auth/login", { email, password });
      const serverUser = await res.json();
      if (serverUser && serverUser.id) {
        const appUser: AppUser = {
          ...serverUser,
          password,
          voiceCredits: serverUser.voiceCredits ?? 0,
          hasPaidViaPaypal: serverUser.hasPaidViaPaypal ?? false,
          freePhotoGenerations: serverUser.freePhotoGenerations ?? 1,
          usedPhotoGenerations: serverUser.usedPhotoGenerations ?? 0,
          freeVideoGenerations: serverUser.freeVideoGenerations ?? 1,
          usedVideoGenerations: serverUser.usedVideoGenerations ?? 0,
        };
        await saveUser(appUser);
        setUser(appUser);
        setIsGuest(false);
        await setCurrentUser(appUser);
        return null;
      }
    } catch (err: any) {
      const errMsg = err.message || "";
      try {
        const jsonPart = errMsg.substring(errMsg.indexOf("{"));
        const parsed = JSON.parse(jsonPart);
        if (parsed.error) return parsed.error;
      } catch {}
      if (errMsg.includes("Account not found")) return "Account not found";
      if (errMsg.includes("Incorrect password")) return "Incorrect password";
      if (errMsg.includes("blocked")) return "Account is blocked";
    }
    const found = await getUserByEmail(email);
    if (!found) return "Account not found";
    if (found.password !== password) return "Incorrect password";
    if (found.blocked) return "Account is blocked";
    setUser(found);
    setIsGuest(false);
    await setCurrentUser(found);
    return null;
  };

  const register = async (
    email: string,
    password: string,
    name: string
  ): Promise<string | null> => {
    const existing = await getUserByEmail(email);
    if (existing) return "Email already registered";
    const trialLimit = await getFreeTrialLimit();
    const newUser: AppUser = {
      id: generateId(),
      email,
      password,
      name,
      role: "user",
      credits: 0,
      voiceCredits: 0,
      hasPaidViaPaypal: false,
      blocked: false,
      createdAt: new Date().toISOString(),
      freeTrialMessages: trialLimit,
      usedMessages: 0,
      freePhotoGenerations: 1,
      usedPhotoGenerations: 0,
      freeVideoGenerations: 1,
      usedVideoGenerations: 0,
    };
    await saveUser(newUser);
    try {
      await apiRequest("POST", "/api/auth/register", { email, password, name });
    } catch {}
    setUser(newUser);
    setIsGuest(false);
    await setCurrentUser(newUser);
    return null;
  };

  const logout = async () => {
    await setCurrentUser(null);
    let guestJson = await AsyncStorage.getItem(GUEST_KEY);
    let guest: AppUser;
    if (guestJson) {
      guest = JSON.parse(guestJson);
    } else {
      guest = createGuestUser();
      await AsyncStorage.setItem(GUEST_KEY, JSON.stringify(guest));
    }
    const countStr = await AsyncStorage.getItem(GUEST_CHAT_COUNT_KEY);
    const count = countStr ? parseInt(countStr, 10) : 0;
    setGuestChatsUsed(count);
    guest.usedMessages = count;
    setUser(guest);
    setIsGuest(true);
  };

  const refreshUser = async () => {
    if (user && !isGuest) {
      const fresh = await getUserByEmail(user.email);
      if (fresh) {
        setUser(fresh);
        await setCurrentUser(fresh);
      }
    }
  };

  const updateUser = async (updated: AppUser) => {
    if (isGuest) {
      setUser(updated);
      return;
    }
    await saveUser(updated);
    if (user && user.id === updated.id) {
      setUser(updated);
      await setCurrentUser(updated);
    }
    try {
      await apiRequest("PUT", `/api/auth/users/${updated.id}`, updated);
    } catch {}
  };

  const getAllUsers = async () => {
    try {
      const res = await apiRequest("GET", "/api/auth/users");
      const serverUsers = await res.json();
      if (Array.isArray(serverUsers) && serverUsers.length > 0) {
        return serverUsers.map((u: any) => ({
          ...u,
          voiceCredits: u.voiceCredits ?? 0,
          hasPaidViaPaypal: u.hasPaidViaPaypal ?? false,
          freePhotoGenerations: u.freePhotoGenerations ?? 1,
          usedPhotoGenerations: u.usedPhotoGenerations ?? 0,
          freeVideoGenerations: u.freeVideoGenerations ?? 1,
          usedVideoGenerations: u.usedVideoGenerations ?? 0,
        })) as AppUser[];
      }
    } catch {}
    return getUsers();
  };

  const deleteUserFn = async (userId: string) => {
    await removeUser(userId);
    try {
      await apiRequest("DELETE", `/api/auth/users/${userId}`);
    } catch {}
  };

  const incrementGuestChats = async (): Promise<number> => {
    const newCount = guestChatsUsed + 1;
    setGuestChatsUsed(newCount);
    await AsyncStorage.setItem(GUEST_CHAT_COUNT_KEY, newCount.toString());
    return GUEST_CHAT_LIMIT - newCount;
  };

  const guestChatsRemaining = Math.max(0, GUEST_CHAT_LIMIT - guestChatsUsed);

  const value = useMemo(
    () => ({
      user,
      isGuest,
      isLoading,
      guestChatsRemaining,
      login,
      register,
      logout,
      refreshUser,
      updateUser,
      getAllUsers,
      deleteUser: deleteUserFn,
      incrementGuestChats,
    }),
    [user, isLoading, isGuest, guestChatsRemaining]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
