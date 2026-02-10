import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  Platform,
  Alert,
  ActivityIndicator,
  ScrollView,
  Switch,
  FlatList,
} from "react-native";
import Animated, { FadeIn, FadeOut, SlideInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { LinearGradient } from "expo-linear-gradient";

const C = Colors.light;

type PhoneTab = "connect" | "calls" | "ai" | "devices" | "logs";

const TTS_VOICES = [
  { id: "nova", label: "Nova", desc: "Warm female" },
  { id: "alloy", label: "Alloy", desc: "Neutral" },
  { id: "echo", label: "Echo", desc: "Male" },
  { id: "fable", label: "Fable", desc: "British" },
  { id: "onyx", label: "Onyx", desc: "Deep male" },
  { id: "shimmer", label: "Shimmer", desc: "Soft female" },
] as const;

const SIP_PRESETS = [
  { name: "Switchboard Free", server: "reg5.switchboardfree.co.uk", port: 5065, transport: "TCP" as const },
  { name: "bOnline", server: "sip.bonline.com", port: 5060, transport: "UDP" as const },
  { name: "Sipgate", server: "sipgate.de", port: 5060, transport: "UDP" as const },
  { name: "VoIP.ms", server: "atlanta1.voip.ms", port: 5060, transport: "UDP" as const },
  { name: "Custom", server: "", port: 5060, transport: "TCP" as const },
];

interface PhoneStatus {
  connected: boolean;
  connecting: boolean;
  registered: boolean;
  error: string | null;
  autoAnswer: boolean;
  activeCall: boolean;
  callsHandled: number;
  lastCallAt: string | null;
  sipUri: string | null;
  uptime: number | null;
  config: {
    server: string;
    port: number;
    username: string;
    transport: string;
    phoneNumber: string;
    displayName: string;
  } | null;
}

interface CallRecord {
  id: string;
  callerNumber: string;
  calledNumber: string;
  timestamp: string;
  duration: number;
  status: "answered" | "missed" | "rejected" | "error";
  aiResponse?: string;
  autoAnswered: boolean;
}

function StatusDot({ status }: { status: "on" | "off" | "connecting" | "error" }) {
  const colors: Record<string, string> = {
    on: C.success,
    off: C.textTertiary,
    connecting: C.warning,
    error: C.danger,
  };
  return (
    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors[status] }} />
  );
}

function formatUptime(seconds: number | null): string {
  if (!seconds) return "--:--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function WebPhoneScreen() {
  const insets = useSafeAreaInsets();
  const { user, isGuest } = useAuth();
  const [tab, setTab] = useState<PhoneTab>("connect");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [sipServer, setSipServer] = useState("sip.switchboardfree.co.uk");
  const [sipPort, setSipPort] = useState("5060");
  const [sipUsername, setSipUsername] = useState("");
  const [sipPassword, setSipPassword] = useState("");
  const [sipTransport, setSipTransport] = useState<"TCP" | "UDP">("TCP");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(0);

  const [status, setStatus] = useState<PhoneStatus>({
    connected: false,
    connecting: false,
    registered: false,
    error: null,
    autoAnswer: true,
    activeCall: false,
    callsHandled: 0,
    lastCallAt: null,
    sipUri: null,
    uptime: null,
    config: null,
  });
  const [callLog, setCallLog] = useState<CallRecord[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [saved, setSaved] = useState(false);

  const [aiGreeting, setAiGreeting] = useState("Hello, thank you for calling. How can I help you today?");
  const [aiSystemPrompt, setAiSystemPrompt] = useState("You are a professional AI receptionist. Be helpful, friendly, and concise.");
  const [aiName, setAiName] = useState("AI Receptionist");
  const [ttsVoice, setTtsVoice] = useState("nova");
  const [autoAnswer, setAutoAnswer] = useState(true);

  const [macDevices, setMacDevices] = useState<{id: string; userId: string; macAddress: string; name: string; createdAt: string; linkedSipConfig?: string}[]>([]);
  const [newDeviceName, setNewDeviceName] = useState("");
  const [creatingDevice, setCreatingDevice] = useState(false);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [editingDeviceName, setEditingDeviceName] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [liveEvent, setLiveEvent] = useState<{type: string; callerNumber?: string; response?: string; timestamp: string} | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const liveEventTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user || isGuest) return;

    const connectWs = () => {
      try {
        const apiUrl = getApiUrl();
        const wsUrl = apiUrl.replace(/^http/, "ws") + `/ws/phone?userId=${user.id}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setWsConnected(true);
        };

        ws.onmessage = (e) => {
          try {
            const event = JSON.parse(e.data);
            if (event.type === "call_incoming" || event.type === "call_answered" || event.type === "ai_response" || event.type === "call_missed") {
              setLiveEvent({
                type: event.type,
                callerNumber: event.data?.callerNumber,
                response: event.data?.response,
                timestamp: event.timestamp,
              });
              Haptics.notificationAsync(
                event.type === "call_incoming"
                  ? Haptics.NotificationFeedbackType.Warning
                  : Haptics.NotificationFeedbackType.Success
              );
              if (liveEventTimerRef.current) clearTimeout(liveEventTimerRef.current);
              liveEventTimerRef.current = setTimeout(() => setLiveEvent(null), 8000);
              fetchStatus();
              fetchCallLog();
            }
          } catch {}
        };

        ws.onclose = () => {
          setWsConnected(false);
          setTimeout(connectWs, 3000);
        };

        ws.onerror = () => {
          setWsConnected(false);
        };

        wsRef.current = ws;
      } catch {}
    };

    connectWs();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (liveEventTimerRef.current) clearTimeout(liveEventTimerRef.current);
    };
  }, [user, isGuest]);

  const fetchStatus = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiRequest("GET", `/api/web-phone/status?userId=${user.id}`);
      const data = await res.json();
      setStatus(data);
    } catch {}
  }, [user]);

  const fetchCallLog = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiRequest("GET", `/api/web-phone/call-log?userId=${user.id}`);
      const data = await res.json();
      setCallLog(data);
    } catch {}
  }, [user]);

  const fetchLogs = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiRequest("GET", `/api/web-phone/logs?userId=${user.id}`);
      const data = await res.json();
      setLogs(data.slice(-100));
    } catch {}
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      fetchStatus();
      fetchCallLog();
      pollRef.current = setInterval(() => {
        fetchStatus();
        fetchCallLog();
      }, 5000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }, [fetchStatus, fetchCallLog])
  );

  const fetchDevices = useCallback(async () => {
    if (!user || isGuest) return;
    try {
      const res = await fetch(new URL(`/api/virtual-mac?userId=${user.id}`, getApiUrl()).toString());
      const data = await res.json();
      if (data.devices) setMacDevices(data.devices);
    } catch {}
  }, [user, isGuest]);

  useEffect(() => {
    if (tab === "logs") fetchLogs();
    if (tab === "devices") fetchDevices();
  }, [tab, fetchLogs, fetchDevices]);

  const handleConnect = async () => {
    if (!user) return;
    if (!sipServer.trim() || !sipUsername.trim() || !sipPassword.trim()) {
      const msg = "Please fill in SIP server, username, and password.";
      if (Platform.OS === "web") alert(msg);
      else Alert.alert("Missing Fields", msg);
      return;
    }

    setConnecting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const res = await apiRequest("POST", "/api/web-phone/connect", {
        userId: user.id,
        sipConfig: {
          server: sipServer.trim(),
          port: parseInt(sipPort) || 5060,
          username: sipUsername.trim(),
          authUsername: sipUsername.trim(),
          password: sipPassword.trim(),
          transport: sipTransport,
          phoneNumber: phoneNumber.trim(),
          displayName: displayName.trim() || phoneNumber.trim() || sipUsername.trim(),
        },
        aiConfig: {
          autoAnswer,
          greeting: aiGreeting,
          systemPrompt: aiSystemPrompt,
          name: aiName,
          ttsVoice,
        },
      });
      const data = await res.json();
      if (data.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setStatus(data.status);
      } else {
        const err = data.error || "Connection failed. Check your credentials.";
        if (Platform.OS === "web") alert(err);
        else Alert.alert("Connection Failed", err);
        if (data.status) setStatus(data.status);
      }
    } catch (err: any) {
      const msg = err.message || "Failed to connect.";
      if (Platform.OS === "web") alert(msg);
      else Alert.alert("Error", msg);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!user) return;
    const doDisconnect = async () => {
      setDisconnecting(true);
      try {
        const res = await apiRequest("POST", "/api/web-phone/disconnect", { userId: user.id });
        const data = await res.json();
        setStatus(data.status);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {} finally {
        setDisconnecting(false);
      }
    };

    if (Platform.OS === "web") {
      if (confirm("Disconnect from SIP server? Incoming calls will no longer be answered.")) doDisconnect();
    } else {
      Alert.alert("Disconnect?", "Incoming calls will no longer be answered.", [
        { text: "Cancel", style: "cancel" },
        { text: "Disconnect", style: "destructive", onPress: doDisconnect },
      ]);
    }
  };

  const handleSaveAI = async () => {
    if (!user) return;
    try {
      await apiRequest("PUT", "/api/web-phone/settings", {
        userId: user.id,
        autoAnswer,
        aiGreeting,
        aiSystemPrompt,
        aiName,
        ttsVoice,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
  };

  const handleToggleAutoAnswer = async (val: boolean) => {
    setAutoAnswer(val);
    if (user && status.connected) {
      try {
        await apiRequest("PUT", "/api/web-phone/settings", { userId: user.id, autoAnswer: val });
        fetchStatus();
      } catch {}
    }
  };

  const handleClearLog = async () => {
    if (!user) return;
    try {
      await apiRequest("DELETE", `/api/web-phone/call-log?userId=${user.id}`);
      setCallLog([]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
  };

  const selectPreset = (idx: number) => {
    setSelectedPreset(idx);
    const p = SIP_PRESETS[idx];
    if (p.server) {
      setSipServer(p.server);
      setSipPort(p.port.toString());
      setSipTransport(p.transport);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleCreateDevice = async () => {
    if (!user) return;
    setCreatingDevice(true);
    try {
      const res = await apiRequest("POST", "/api/virtual-mac", {
        userId: user.id,
        name: newDeviceName.trim() || "Virtual Device",
      });
      const data = await res.json();
      if (data.success && data.device) {
        setMacDevices((prev) => [data.device, ...prev]);
        setNewDeviceName("");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {} finally {
      setCreatingDevice(false);
    }
  };

  const handleDeleteDevice = async (id: string) => {
    if (!user) return;
    const doDelete = async () => {
      try {
        await apiRequest("DELETE", `/api/virtual-mac/${id}?userId=${user.id}`);
        setMacDevices((prev) => prev.filter((d) => d.id !== id));
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
    };
    if (Platform.OS === "web") {
      if (confirm("Delete this virtual device?")) doDelete();
    } else {
      Alert.alert("Delete Device?", "This MAC address will be removed.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const handleRenameDevice = async (id: string) => {
    if (!editingDeviceName.trim()) return;
    try {
      const res = await apiRequest("PUT", `/api/virtual-mac/${id}`, { name: editingDeviceName.trim() });
      const data = await res.json();
      if (data.success && data.device) {
        setMacDevices((prev) => prev.map((d) => (d.id === id ? data.device : d)));
      }
    } catch {} finally {
      setEditingDeviceId(null);
      setEditingDeviceName("");
    }
  };

  const handleRegenerateMac = async (id: string) => {
    try {
      const res = await apiRequest("POST", `/api/virtual-mac/${id}/regenerate`);
      const data = await res.json();
      if (data.success && data.device) {
        setMacDevices((prev) => prev.map((d) => (d.id === id ? data.device : d)));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {}
  };

  const handleCopyMac = async (mac: string, id: string) => {
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(mac);
      } else {
        const Clipboard = require("expo-clipboard");
        await Clipboard.setStringAsync(mac);
      }
      setCopiedId(id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  if (isGuest) {
    return (
      <View style={s.container}>
        <View style={[s.guestContent, { paddingTop: topInset + 40 }]}>
          <View style={s.guestIconWrap}>
            <MaterialCommunityIcons name="phone-voip" size={40} color={C.tint} />
          </View>
          <Text style={s.guestTitle}>Web Phone</Text>
          <Text style={s.guestDesc}>
            Sign up to connect your SIP phone and let your AI twin answer calls automatically
          </Text>
          <Pressable
            onPress={() => router.push("/auth")}
            style={({ pressed }) => [s.guestBtn, { opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={s.guestBtnText}>Sign Up Free</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const statusLabel = status.connected ? "Connected" : status.connecting ? "Connecting..." : status.error ? "Error" : "Offline";
  const statusDot: "on" | "off" | "connecting" | "error" = status.connected ? "on" : status.connecting ? "connecting" : status.error ? "error" : "off";

  const renderCallRecord = ({ item }: { item: CallRecord }) => {
    const iconName = item.status === "answered" ? "call" : item.status === "missed" ? "call-outline" : "close-circle-outline";
    const iconColor = item.status === "answered" ? C.success : item.status === "missed" ? C.warning : C.danger;
    return (
      <View style={s.callItem}>
        <Ionicons name={iconName as any} size={20} color={iconColor} />
        <View style={s.callItemContent}>
          <Text style={s.callItemNumber}>{item.callerNumber || "Unknown"}</Text>
          <Text style={s.callItemMeta}>
            {formatDate(item.timestamp)} {formatTime(item.timestamp)}
            {item.autoAnswered ? " - AI answered" : ""}
          </Text>
          {item.aiResponse ? (
            <Text style={s.callItemAI} numberOfLines={2}>
              {item.aiResponse}
            </Text>
          ) : null}
        </View>
        <View style={s.callItemBadge}>
          <Text style={[s.callItemBadgeText, { color: iconColor }]}>
            {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={s.container}>
      <View style={[s.headerArea, { paddingTop: topInset + 8 }]}>
        <LinearGradient
          colors={status.connected ? [C.success + "15", "transparent"] : [C.background, C.background]}
          style={StyleSheet.absoluteFill}
        />

        <View style={s.statusRow}>
          <View style={s.statusLeft}>
            <View style={[s.phoneBadge, status.connected && s.phoneBadgeActive]}>
              <MaterialCommunityIcons
                name={status.connected ? "phone-check" : "phone-off"}
                size={22}
                color={status.connected ? C.success : C.textTertiary}
              />
            </View>
            <View>
              <Text style={s.headerTitle}>Web Phone</Text>
              <View style={s.statusLine}>
                <StatusDot status={statusDot} />
                <Text style={[s.statusText, { color: status.connected ? C.success : status.error ? C.danger : C.textSecondary }]}>
                  {statusLabel}
                </Text>
              </View>
            </View>
          </View>
          {status.connected && (
            <View style={s.uptimeBox}>
              <Feather name="clock" size={12} color={C.textSecondary} />
              <Text style={s.uptimeText}>{formatUptime(status.uptime)}</Text>
            </View>
          )}
        </View>

        {status.connected && (
          <View style={s.statsRow}>
            <View style={s.statBox}>
              <Text style={s.statValue}>{status.callsHandled}</Text>
              <Text style={s.statLabel}>Calls</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statBox}>
              <Text style={s.statValue}>{status.autoAnswer ? "ON" : "OFF"}</Text>
              <Text style={s.statLabel}>Auto-Answer</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statBox}>
              <Text style={s.statValue}>{status.activeCall ? "Active" : "Idle"}</Text>
              <Text style={s.statLabel}>Call</Text>
            </View>
          </View>
        )}
      </View>

      {liveEvent && (
        <Animated.View
          entering={SlideInUp.duration(300)}
          exiting={FadeOut.duration(200)}
          style={s.liveEventBanner}
        >
          <LinearGradient
            colors={
              liveEvent.type === "call_incoming" ? ["#FF6B3520", "#FF6B3508"] :
              liveEvent.type === "ai_response" ? [C.success + "20", C.success + "08"] :
              [C.tint + "20", C.tint + "08"]
            }
            style={StyleSheet.absoluteFill}
          />
          <View style={s.liveEventIcon}>
            <Ionicons
              name={
                liveEvent.type === "call_incoming" ? "call" :
                liveEvent.type === "ai_response" ? "chatbubble" :
                liveEvent.type === "call_missed" ? "call-outline" :
                "checkmark-circle"
              }
              size={20}
              color={
                liveEvent.type === "call_incoming" ? "#FF6B35" :
                liveEvent.type === "ai_response" ? C.success :
                liveEvent.type === "call_missed" ? C.warning :
                C.tint
              }
            />
          </View>
          <View style={s.liveEventContent}>
            <Text style={s.liveEventTitle}>
              {liveEvent.type === "call_incoming" ? "Incoming Call" :
               liveEvent.type === "call_answered" ? "Call Answered" :
               liveEvent.type === "ai_response" ? "AI Responded" :
               "Call Missed"}
            </Text>
            <Text style={s.liveEventSub} numberOfLines={2}>
              {liveEvent.callerNumber || "Unknown"}
              {liveEvent.response ? ` - "${liveEvent.response.substring(0, 80)}..."` : ""}
            </Text>
          </View>
          <Text style={s.liveEventTime}>LIVE</Text>
        </Animated.View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar} contentContainerStyle={s.tabBarContent}>
        {([
          { key: "connect" as const, icon: "wifi", label: "Connect" },
          { key: "calls" as const, icon: "call", label: "Calls" },
          { key: "ai" as const, icon: "hardware-chip", label: "AI Twin" },
          { key: "devices" as const, icon: "hardware-chip-outline", label: "Devices" },
          { key: "logs" as const, icon: "terminal", label: "Logs" },
        ] as const).map((t) => (
          <Pressable
            key={t.key}
            onPress={() => { setTab(t.key); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={[s.tabItem, tab === t.key && s.tabItemActive]}
          >
            <Ionicons name={t.icon as any} size={18} color={tab === t.key ? C.tint : C.textTertiary} />
            <Text style={[s.tabLabel, tab === t.key && s.tabLabelActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {tab === "connect" ? (
        <KeyboardAwareScrollViewCompat
          style={s.scrollArea}
          contentContainerStyle={s.scrollContent}
          bottomOffset={20}
        >
          {status.connected && status.config ? (
            <View style={s.connectedCard}>
              <View style={s.connectedHeader}>
                <View style={s.connectedPulse}>
                  <MaterialCommunityIcons name="phone-in-talk" size={28} color={C.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.connectedTitle}>Phone Registered</Text>
                  <Text style={s.connectedSub}>
                    {status.config.server}:{status.config.port} ({status.config.transport})
                  </Text>
                </View>
              </View>

              <View style={s.connectedDetails}>
                <View style={s.connectedRow}>
                  <Text style={s.connectedLabel}>SIP User</Text>
                  <Text style={s.connectedValue}>{status.config.username}</Text>
                </View>
                {status.config.phoneNumber ? (
                  <View style={s.connectedRow}>
                    <Text style={s.connectedLabel}>Number</Text>
                    <Text style={s.connectedValue}>{status.config.phoneNumber}</Text>
                  </View>
                ) : null}
                {status.sipUri ? (
                  <View style={s.connectedRow}>
                    <Text style={s.connectedLabel}>SIP URI</Text>
                    <Text style={[s.connectedValue, s.mono]} numberOfLines={1}>{status.sipUri}</Text>
                  </View>
                ) : null}
              </View>

              <View style={s.autoAnswerRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.autoAnswerLabel}>Auto-Answer with AI</Text>
                  <Text style={s.autoAnswerDesc}>AI twin answers all incoming calls</Text>
                </View>
                <Switch
                  value={autoAnswer}
                  onValueChange={handleToggleAutoAnswer}
                  trackColor={{ false: C.borderLight, true: C.success + "60" }}
                  thumbColor={autoAnswer ? C.success : C.textTertiary}
                />
              </View>

              <Pressable
                onPress={handleDisconnect}
                disabled={disconnecting}
                style={({ pressed }) => [s.disconnectBtn, { opacity: pressed || disconnecting ? 0.7 : 1 }]}
              >
                {disconnecting ? (
                  <ActivityIndicator size="small" color={C.danger} />
                ) : (
                  <>
                    <Ionicons name="power" size={18} color={C.danger} />
                    <Text style={s.disconnectBtnText}>Disconnect</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={s.sectionTitle}>SIP Provider</Text>
              <View style={s.presetRow}>
                {SIP_PRESETS.map((p, i) => (
                  <Pressable
                    key={i}
                    onPress={() => selectPreset(i)}
                    style={[s.presetBtn, selectedPreset === i && s.presetBtnActive]}
                  >
                    <Text style={[s.presetText, selectedPreset === i && s.presetTextActive]}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={s.formCard}>
                <View style={s.fieldGroup}>
                  <Text style={s.fieldLabel}>SIP Server</Text>
                  <TextInput
                    style={s.textInput}
                    value={sipServer}
                    onChangeText={setSipServer}
                    placeholder="sip.provider.com"
                    placeholderTextColor={C.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <View style={s.rowFields}>
                  <View style={[s.fieldGroup, { flex: 1 }]}>
                    <Text style={s.fieldLabel}>Port</Text>
                    <TextInput
                      style={s.textInput}
                      value={sipPort}
                      onChangeText={setSipPort}
                      placeholder="5060"
                      placeholderTextColor={C.placeholder}
                      keyboardType="number-pad"
                    />
                  </View>
                  <View style={[s.fieldGroup, { flex: 1.5 }]}>
                    <Text style={s.fieldLabel}>Transport</Text>
                    <View style={s.transportRow}>
                      {(["TCP", "UDP"] as const).map((t) => (
                        <Pressable
                          key={t}
                          onPress={() => setSipTransport(t)}
                          style={[s.transportBtn, sipTransport === t && s.transportBtnActive]}
                        >
                          <Text style={[s.transportText, sipTransport === t && s.transportTextActive]}>{t}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>

                <View style={s.fieldGroup}>
                  <Text style={s.fieldLabel}>Username / Extension</Text>
                  <TextInput
                    style={s.textInput}
                    value={sipUsername}
                    onChangeText={setSipUsername}
                    placeholder="Your SIP username or extension"
                    placeholderTextColor={C.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <View style={s.fieldGroup}>
                  <Text style={s.fieldLabel}>Password</Text>
                  <View style={s.passwordRow}>
                    <TextInput
                      style={[s.textInput, { flex: 1 }]}
                      value={sipPassword}
                      onChangeText={setSipPassword}
                      placeholder="SIP password"
                      placeholderTextColor={C.placeholder}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Pressable onPress={() => setShowPassword(!showPassword)} style={s.eyeBtn}>
                      <Ionicons name={showPassword ? "eye-off" : "eye"} size={20} color={C.textSecondary} />
                    </Pressable>
                  </View>
                </View>

                <View style={s.fieldGroup}>
                  <Text style={s.fieldLabel}>Phone Number (optional)</Text>
                  <TextInput
                    style={s.textInput}
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    placeholder="+447728817379"
                    placeholderTextColor={C.placeholder}
                    keyboardType="phone-pad"
                  />
                </View>

                <View style={s.fieldGroup}>
                  <Text style={s.fieldLabel}>Display Name (optional)</Text>
                  <TextInput
                    style={s.textInput}
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="My Business"
                    placeholderTextColor={C.placeholder}
                  />
                </View>
              </View>

              {status.error && (
                <View style={s.errorBanner}>
                  <Ionicons name="warning" size={16} color={C.danger} />
                  <Text style={s.errorText}>{status.error}</Text>
                </View>
              )}

              <Pressable
                onPress={handleConnect}
                disabled={connecting}
                style={({ pressed }) => [s.connectBtn, { opacity: pressed || connecting ? 0.7 : 1 }]}
              >
                {connecting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="phone-check" size={20} color="#FFF" />
                    <Text style={s.connectBtnText}>Connect Phone</Text>
                  </>
                )}
              </Pressable>

              <View style={s.infoBox}>
                <Ionicons name="information-circle" size={18} color={C.accent} />
                <Text style={s.infoText}>
                  Enter your SIP credentials from Switchboard Free or any SIP provider. Our server will register as your phone device and answer incoming calls with your AI twin, bypassing the provider's IVR completely.
                </Text>
              </View>
            </>
          )}
        </KeyboardAwareScrollViewCompat>
      ) : tab === "calls" ? (
        <View style={s.scrollArea}>
          <View style={s.callHeader}>
            <Text style={s.callHeaderTitle}>{callLog.length} Call{callLog.length !== 1 ? "s" : ""}</Text>
            {callLog.length > 0 && (
              <Pressable onPress={handleClearLog} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                <Ionicons name="trash-outline" size={20} color={C.textTertiary} />
              </Pressable>
            )}
          </View>
          {callLog.length === 0 ? (
            <View style={s.emptyState}>
              <Ionicons name="call-outline" size={40} color={C.textTertiary} />
              <Text style={s.emptyTitle}>No calls yet</Text>
              <Text style={s.emptyDesc}>
                {status.connected
                  ? "Waiting for incoming calls. Your AI twin will answer automatically."
                  : "Connect your phone to start receiving calls."}
              </Text>
            </View>
          ) : (
            <FlatList
              data={callLog}
              keyExtractor={(item) => item.id}
              renderItem={renderCallRecord}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
              showsVerticalScrollIndicator={false}
              scrollEnabled={callLog.length > 0}
            />
          )}
        </View>
      ) : tab === "ai" ? (
        <KeyboardAwareScrollViewCompat
          style={s.scrollArea}
          contentContainerStyle={s.scrollContent}
          bottomOffset={20}
        >
          {saved && (
            <View style={s.savedBanner}>
              <Ionicons name="checkmark-circle" size={16} color={C.success} />
              <Text style={s.savedText}>Settings saved</Text>
            </View>
          )}

          <View style={s.formCard}>
            <Text style={s.formCardTitle}>AI Twin Configuration</Text>
            <Text style={s.formCardDesc}>
              Configure how your AI twin answers incoming calls
            </Text>

            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>AI Name</Text>
              <TextInput
                style={s.textInput}
                value={aiName}
                onChangeText={setAiName}
                placeholder="AI Receptionist"
                placeholderTextColor={C.placeholder}
              />
            </View>

            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>Greeting</Text>
              <TextInput
                style={[s.textInput, s.textArea]}
                value={aiGreeting}
                onChangeText={setAiGreeting}
                placeholder="Hello, thank you for calling..."
                placeholderTextColor={C.placeholder}
                multiline
              />
            </View>

            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>System Instructions</Text>
              <TextInput
                style={[s.textInput, s.textArea]}
                value={aiSystemPrompt}
                onChangeText={setAiSystemPrompt}
                placeholder="Instructions for how the AI should behave..."
                placeholderTextColor={C.placeholder}
                multiline
              />
            </View>
          </View>

          <View style={s.formCard}>
            <Text style={s.formCardTitle}>Voice</Text>
            <Text style={s.formCardDesc}>Choose the voice for your AI twin</Text>
            <View style={s.voiceGrid}>
              {TTS_VOICES.map((v) => (
                <Pressable
                  key={v.id}
                  onPress={() => { setTtsVoice(v.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  style={[s.voiceBtn, ttsVoice === v.id && s.voiceBtnActive]}
                >
                  <Ionicons
                    name={ttsVoice === v.id ? "volume-high" : "volume-medium-outline"}
                    size={18}
                    color={ttsVoice === v.id ? C.tint : C.textSecondary}
                  />
                  <Text style={[s.voiceName, ttsVoice === v.id && s.voiceNameActive]}>{v.label}</Text>
                  <Text style={s.voiceDesc}>{v.desc}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable
            onPress={handleSaveAI}
            style={({ pressed }) => [s.saveBtn, { opacity: pressed ? 0.8 : 1 }]}
          >
            <Ionicons name="checkmark" size={18} color="#FFF" />
            <Text style={s.saveBtnText}>Save AI Settings</Text>
          </Pressable>
        </KeyboardAwareScrollViewCompat>
      ) : tab === "devices" ? (
        <KeyboardAwareScrollViewCompat
          style={s.scrollArea}
          contentContainerStyle={s.scrollContent}
          bottomOffset={20}
        >
          <View style={s.sectionCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <MaterialCommunityIcons name="ethernet" size={22} color={C.tint} />
              <Text style={s.sectionTitle}>Virtual MAC Devices</Text>
            </View>
            <Text style={s.sectionDesc}>
              Generate virtual MAC addresses for your VoIP provider (bOnline, etc). Copy the MAC and paste it into your provider's "Add a device" form.
            </Text>
          </View>

          <View style={s.sectionCard}>
            <Text style={s.fieldLabel}>Device Name</Text>
            <TextInput
              style={s.input}
              value={newDeviceName}
              onChangeText={setNewDeviceName}
              placeholder="e.g. Main Line, After Hours"
              placeholderTextColor={C.textTertiary}
            />
            <Pressable
              onPress={handleCreateDevice}
              disabled={creatingDevice}
              style={({ pressed }) => [s.saveBtn, { opacity: pressed || creatingDevice ? 0.7 : 1, marginTop: 10 }]}
            >
              {creatingDevice ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Ionicons name="add" size={18} color="#FFF" />
              )}
              <Text style={s.saveBtnText}>Generate MAC Address</Text>
            </Pressable>
          </View>

          {macDevices.length === 0 ? (
            <View style={s.emptyState}>
              <Ionicons name="hardware-chip-outline" size={36} color={C.textTertiary} />
              <Text style={s.emptyTitle}>No Devices Yet</Text>
              <Text style={s.emptyDesc}>Generate a virtual MAC address above to get started</Text>
            </View>
          ) : (
            macDevices.map((device) => (
              <View key={device.id} style={s.sectionCard}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  {editingDeviceId === device.id ? (
                    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <TextInput
                        style={[s.input, { flex: 1 }]}
                        value={editingDeviceName}
                        onChangeText={setEditingDeviceName}
                        autoFocus
                        onSubmitEditing={() => handleRenameDevice(device.id)}
                      />
                      <Pressable onPress={() => handleRenameDevice(device.id)}>
                        <Ionicons name="checkmark" size={22} color={C.success} />
                      </Pressable>
                      <Pressable onPress={() => { setEditingDeviceId(null); setEditingDeviceName(""); }}>
                        <Ionicons name="close" size={22} color={C.textTertiary} />
                      </Pressable>
                    </View>
                  ) : (
                    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <MaterialCommunityIcons name="router-wireless" size={20} color={C.tint} />
                      <Text style={s.fieldLabel}>{device.name}</Text>
                      <Pressable onPress={() => { setEditingDeviceId(device.id); setEditingDeviceName(device.name); }}>
                        <Feather name="edit-2" size={14} color={C.textTertiary} />
                      </Pressable>
                    </View>
                  )}
                </View>

                <View style={{
                  backgroundColor: C.background,
                  borderRadius: 12,
                  padding: 16,
                  marginTop: 10,
                  alignItems: "center",
                }}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textTertiary, marginBottom: 6 }}>
                    MAC Address
                  </Text>
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                    {device.macAddress.split("-").map((pair, i) => (
                      <View key={i} style={{
                        backgroundColor: C.card,
                        borderRadius: 8,
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        borderWidth: 1,
                        borderColor: C.borderLight,
                        minWidth: 44,
                        alignItems: "center",
                      }}>
                        <Text style={{
                          fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                          fontSize: 16,
                          fontWeight: "700" as const,
                          color: C.text,
                          letterSpacing: 1,
                        }}>
                          {pair}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textTertiary, marginTop: 8 }}>
                    Format: {device.macAddress}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                  <Pressable
                    onPress={() => handleCopyMac(device.macAddress, device.id)}
                    style={({ pressed }) => ({
                      flex: 1,
                      flexDirection: "row" as const,
                      alignItems: "center" as const,
                      justifyContent: "center" as const,
                      gap: 6,
                      backgroundColor: copiedId === device.id ? C.success + "15" : C.tint + "15",
                      paddingVertical: 10,
                      borderRadius: 10,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Ionicons
                      name={copiedId === device.id ? "checkmark" : "copy-outline"}
                      size={16}
                      color={copiedId === device.id ? C.success : C.tint}
                    />
                    <Text style={{
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                      color: copiedId === device.id ? C.success : C.tint,
                    }}>
                      {copiedId === device.id ? "Copied" : "Copy MAC"}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => handleRegenerateMac(device.id)}
                    style={({ pressed }) => ({
                      flexDirection: "row" as const,
                      alignItems: "center" as const,
                      justifyContent: "center" as const,
                      gap: 6,
                      backgroundColor: C.warning + "15",
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 10,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Ionicons name="refresh" size={16} color={C.warning} />
                  </Pressable>

                  <Pressable
                    onPress={() => handleDeleteDevice(device.id)}
                    style={({ pressed }) => ({
                      flexDirection: "row" as const,
                      alignItems: "center" as const,
                      justifyContent: "center" as const,
                      gap: 6,
                      backgroundColor: C.danger + "15",
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 10,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Ionicons name="trash-outline" size={16} color={C.danger} />
                  </Pressable>
                </View>

                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textTertiary, marginTop: 8, textAlign: "center" }}>
                  Created {new Date(device.createdAt).toLocaleDateString()}
                </Text>
              </View>
            ))
          )}

          <View style={[s.sectionCard, { marginTop: 8 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Ionicons name="information-circle-outline" size={18} color={C.textSecondary} />
              <Text style={[s.fieldLabel, { marginBottom: 0 }]}>How to use</Text>
            </View>
            <Text style={s.sectionDesc}>
              1. Generate a virtual MAC address above{"\n"}
              2. Copy the MAC address{"\n"}
              3. Go to your VoIP provider (bOnline, etc){"\n"}
              4. Add a new device and paste the MAC{"\n"}
              5. Assign it to your user/line{"\n"}
              6. Your AI receptionist will answer calls on that device
            </Text>
          </View>
        </KeyboardAwareScrollViewCompat>
      ) : tab === "logs" ? (
        <View style={s.scrollArea}>
          <View style={s.logHeader}>
            <Text style={s.logHeaderTitle}>SIP Logs</Text>
            <Pressable onPress={fetchLogs} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Ionicons name="refresh" size={20} color={C.textTertiary} />
            </Pressable>
          </View>
          <ScrollView style={s.logScroll} contentContainerStyle={{ paddingBottom: 120 }}>
            {logs.length === 0 ? (
              <Text style={s.logEmpty}>No logs available. Connect to start logging.</Text>
            ) : (
              logs.map((log, i) => (
                <Text key={i} style={s.logLine}>{log}</Text>
              ))
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  guestContent: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: 32,
  },
  guestIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: C.tint + "15",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    marginBottom: 20,
  },
  guestTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    color: C.text,
    marginBottom: 8,
  },
  guestDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: C.textSecondary,
    textAlign: "center" as const,
    marginBottom: 24,
    lineHeight: 22,
  },
  guestBtn: {
    backgroundColor: C.tint,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
  },
  guestBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: "#FFF",
  },

  headerArea: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  statusRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  statusLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  },
  phoneBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: C.card,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  phoneBadgeActive: {
    backgroundColor: C.success + "15",
    borderColor: C.success + "40",
  },
  headerTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: C.text,
  },
  statusLine: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginTop: 2,
  },
  statusText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  uptimeBox: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    backgroundColor: C.card,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  uptimeText: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    color: C.textSecondary,
  },

  statsRow: {
    flexDirection: "row" as const,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  statBox: {
    flex: 1,
    alignItems: "center" as const,
  },
  statValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: C.text,
  },
  statLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: C.textTertiary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: C.borderLight,
  },

  tabBar: {
    maxHeight: 44,
    marginBottom: 4,
  },
  tabBarContent: {
    paddingHorizontal: 16,
    gap: 4,
  },
  tabItem: {
    flexDirection: "row" as const,
    paddingHorizontal: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  tabItemActive: {
    backgroundColor: C.tint + "15",
  },
  tabLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: C.textTertiary,
  },
  tabLabelActive: {
    color: C.tint,
  },

  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 120,
    gap: 14,
  },

  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: C.text,
    marginBottom: 2,
  },
  presetRow: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
  presetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: "transparent",
  },
  presetBtnActive: {
    borderColor: C.tint,
    backgroundColor: C.tint + "15",
  },
  presetText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: C.textSecondary,
  },
  presetTextActive: {
    color: C.tint,
  },

  formCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  formCardTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: C.text,
  },
  formCardDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: C.textSecondary,
    marginTop: -6,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: C.textSecondary,
  },
  textInput: {
    backgroundColor: C.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.text,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: "top" as const,
    paddingTop: 12,
  },
  rowFields: {
    flexDirection: "row" as const,
    gap: 12,
  },
  transportRow: {
    flexDirection: "row" as const,
    gap: 8,
  },
  transportBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: C.inputBackground,
    alignItems: "center" as const,
    borderWidth: 1,
    borderColor: C.inputBorder,
  },
  transportBtnActive: {
    borderColor: C.tint,
    backgroundColor: C.tint + "15",
  },
  transportText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: C.textSecondary,
  },
  transportTextActive: {
    color: C.tint,
  },
  passwordRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  eyeBtn: {
    padding: 10,
    backgroundColor: C.inputBackground,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.inputBorder,
  },

  errorBanner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    backgroundColor: C.danger + "15",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.danger + "30",
  },
  errorText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: C.danger,
    lineHeight: 20,
  },

  connectBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    backgroundColor: C.tint,
    paddingVertical: 16,
    borderRadius: 16,
  },
  connectBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: "#FFF",
  },

  infoBox: {
    flexDirection: "row" as const,
    gap: 10,
    backgroundColor: C.accent + "10",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.accent + "25",
  },
  infoText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 19,
  },

  connectedCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    gap: 16,
    borderWidth: 1,
    borderColor: C.success + "30",
  },
  connectedHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 14,
  },
  connectedPulse: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: C.success + "15",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 1,
    borderColor: C.success + "30",
  },
  connectedTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 17,
    color: C.success,
  },
  connectedSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: C.textSecondary,
    marginTop: 2,
  },
  connectedDetails: {
    backgroundColor: C.background,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  connectedRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  connectedLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: C.textSecondary,
  },
  connectedValue: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: C.text,
    maxWidth: "60%" as any,
  },
  mono: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
  },

  autoAnswerRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: C.background,
    borderRadius: 12,
    padding: 14,
  },
  autoAnswerLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
  autoAnswerDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },

  disconnectBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: C.danger + "15",
    borderWidth: 1,
    borderColor: C.danger + "30",
  },
  disconnectBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.danger,
  },

  callHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  callHeaderTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: C.text,
  },
  callItem: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 12,
    backgroundColor: C.card,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  callItemContent: {
    flex: 1,
    gap: 3,
  },
  callItemNumber: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
  callItemMeta: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textSecondary,
  },
  callItemAI: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textTertiary,
    fontStyle: "italic" as const,
    marginTop: 4,
  },
  callItemBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: C.background,
  },
  callItemBadgeText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
  },

  emptyState: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingTop: 60,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: C.text,
    marginTop: 8,
  },
  emptyDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: C.textSecondary,
    textAlign: "center" as const,
    paddingHorizontal: 40,
    lineHeight: 20,
  },

  voiceGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
  voiceBtn: {
    width: "48%" as any,
    backgroundColor: C.background,
    borderRadius: 12,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: "transparent",
  },
  voiceBtnActive: {
    borderColor: C.tint,
    backgroundColor: C.tint + "10",
  },
  voiceName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
  voiceNameActive: {
    color: C.tint,
  },
  voiceDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textTertiary,
  },

  saveBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    backgroundColor: C.tint,
    paddingVertical: 14,
    borderRadius: 14,
  },
  saveBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#FFF",
  },

  savedBanner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    backgroundColor: C.success + "15",
    padding: 12,
    borderRadius: 10,
  },
  savedText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: C.success,
  },

  logHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  logHeaderTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: C.text,
  },
  logScroll: {
    flex: 1,
    paddingHorizontal: 16,
  },
  logEmpty: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: C.textTertiary,
    paddingTop: 20,
    textAlign: "center" as const,
  },
  logLine: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
    color: C.textSecondary,
    lineHeight: 18,
    paddingVertical: 1,
  },

  liveEventBanner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.borderLight,
    overflow: "hidden" as const,
  },
  liveEventIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.card,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    marginRight: 10,
  },
  liveEventContent: {
    flex: 1,
  },
  liveEventTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: C.text,
  },
  liveEventSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  liveEventTime: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    color: "#FF3B30",
    letterSpacing: 1,
  },
});
