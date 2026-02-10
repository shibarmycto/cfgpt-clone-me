import React, { useState, useEffect, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  RefreshControl,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/contexts/AuthContext";
import {
  Conversation,
  getConversations,
  getVoiceSamples,
  getSipConfig,
  saveConversation,
  generateId,
} from "@/lib/storage-helpers";
import Colors from "@/constants/colors";

const C = Colors.light;

const PERSONALITY_STORAGE_KEY = "cfgpt_selected_personality";
type PersonalityId = "urban" | "trader" | "eliza";

const MASCOT_IMAGES: Record<PersonalityId, any> = {
  urban: require("@/assets/images/cf_urban.png"),
  trader: require("@/assets/images/cf_trader.png"),
  eliza: require("@/assets/images/cf_eliza.png"),
};

const MASCOT_DATA: { id: PersonalityId; name: string; tagline: string; color: string }[] = [
  { id: "urban", name: "CF Urban", tagline: "Crypto & vibes", color: "#00E676" },
  { id: "trader", name: "CF Trader", tagline: "Markets & luxury", color: "#FFD700" },
  { id: "eliza", name: "CF Eliza", tagline: "Positivity & gossip", color: "#FF69B4" },
];

interface StatCard {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  color: string;
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const { user, isGuest, logout, guestChatsRemaining } = useAuth();
  const [stats, setStats] = useState<StatCard[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = useCallback(async () => {
    if (!user) return;
    const convos = await getConversations(user.id);
    const voices = await getVoiceSamples(user.id);
    const sipConfig = await getSipConfig(user.id);
    const remaining = user.freeTrialMessages - user.usedMessages + user.credits;

    setStats([
      {
        icon: "chatbubbles",
        label: "Conversations",
        value: convos.length.toString(),
        color: C.accent,
      },
      {
        icon: "mic",
        label: "Voice Samples",
        value: voices.length.toString(),
        color: C.purple,
      },
      {
        icon: "diamond",
        label: "Credits Left",
        value: Math.max(0, remaining).toString(),
        color: C.tint,
      },
      {
        icon: "call",
        label: "SIP Status",
        value: sipConfig ? "Active" : "Not Set",
        color: sipConfig ? C.success : C.warning,
      },
    ]);
  }, [user]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  };

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  const handleChatWithMascot = async (pid: PersonalityId) => {
    await AsyncStorage.setItem(PERSONALITY_STORAGE_KEY, pid);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!user) return;
    const mascotName = MASCOT_DATA.find(m => m.id === pid)?.name || "CF";
    const conv: Conversation = {
      id: generateId(),
      title: `Chat with ${mascotName}`,
      userId: user.id,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveConversation(conv);
    router.push({ pathname: "/chat/[id]", params: { id: conv.id } });
  };

  const quickActions = [
    {
      icon: "add-circle" as const,
      label: "New Chat",
      onPress: () => router.push("/(tabs)/chat"),
    },
    {
      icon: "mic" as const,
      label: "Add Voice",
      onPress: () => router.push("/(tabs)/voice"),
    },
    {
      icon: "settings" as const,
      label: "SIP Setup",
      onPress: () => router.push("/(tabs)/config"),
    },
  ];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: topInset + 16, paddingBottom: 100 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.tint}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.greeting}>{isGuest ? "Welcome to" : "Welcome back,"}</Text>
            <Text style={styles.userName}>{isGuest ? "CFGPT Ultra AI" : (user?.name || "User")}</Text>
          </View>
          {isGuest ? (
            <Pressable onPress={() => router.push("/auth")} style={styles.signUpBtn}>
              <Ionicons name="person-add" size={16} color="#FFF" />
              <Text style={styles.signUpBtnText}>Sign Up</Text>
            </Pressable>
          ) : (
            <Pressable onPress={logout} style={styles.logoutBtn}>
              <Ionicons name="log-out-outline" size={22} color={C.textSecondary} />
            </Pressable>
          )}
        </View>

        {isGuest ? (
          <Pressable
            onPress={() => router.push("/auth")}
            style={({ pressed }) => [
              styles.guestBanner,
              { opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <View style={styles.guestBannerContent}>
              <View style={styles.guestBannerIcon}>
                <Ionicons name="sparkles" size={20} color={C.tint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.guestBannerTitle}>Try AI Chat Free</Text>
                <Text style={styles.guestBannerText}>
                  {guestChatsRemaining} free messages available. Sign up to unlock everything!
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={18} color={C.tint} />
            </View>
          </Pressable>
        ) : (
          <View style={styles.roleChip}>
            <Ionicons
              name={
                user?.role === "super_admin"
                  ? "shield-checkmark"
                  : user?.role === "admin"
                    ? "shield"
                    : "person"
              }
              size={14}
              color={C.tint}
            />
            <Text style={styles.roleText}>
              {user?.role === "super_admin"
                ? "Super Admin"
                : user?.role === "admin"
                  ? "Admin"
                  : "User"}
            </Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Meet the AI Squad</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mascotRow}>
          {MASCOT_DATA.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => handleChatWithMascot(m.id)}
              style={({ pressed }) => [
                styles.mascotCard,
                { borderColor: m.color + "60", opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View style={[styles.mascotImgWrap, { borderColor: m.color }]}>
                <Image source={MASCOT_IMAGES[m.id]} style={styles.mascotImg} />
              </View>
              <Text style={[styles.mascotName, { color: m.color }]}>{m.name}</Text>
              <Text style={styles.mascotTagline}>{m.tagline}</Text>
              <View style={[styles.mascotChatBtn, { backgroundColor: m.color + "20" }]}>
                <Ionicons name="chatbubble" size={10} color={m.color} />
                <Text style={[styles.mascotChatBtnText, { color: m.color }]}>Chat Now</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.statsGrid}>
          {stats.map((stat, i) => (
            <View key={i} style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: stat.color + "20" }]}>
                <Ionicons name={stat.icon} size={20} color={stat.color} />
              </View>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsRow}>
          {quickActions.map((action, i) => (
            <Pressable
              key={i}
              onPress={action.onPress}
              style={({ pressed }) => [
                styles.actionCard,
                { opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <LinearGradient
                colors={[C.card, C.cardElevated]}
                style={styles.actionGradient}
              >
                <Ionicons name={action.icon} size={28} color={C.tint} />
                <Text style={styles.actionLabel}>{action.label}</Text>
              </LinearGradient>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Usage</Text>
        <View style={styles.usageCard}>
          <View style={styles.usageRow}>
            <Text style={styles.usageLabel}>{isGuest ? "Free Chats Used" : "Messages Used"}</Text>
            <Text style={styles.usageValue}>{isGuest ? (5 - guestChatsRemaining) : (user?.usedMessages || 0)}</Text>
          </View>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.min(
                    100,
                    isGuest
                      ? ((5 - guestChatsRemaining) / 5) * 100
                      : ((user?.usedMessages || 0) /
                        Math.max(1, (user?.freeTrialMessages || 10) + (user?.credits || 0))) *
                        100
                  )}%`,
                },
              ]}
            />
          </View>
          {isGuest ? (
            <View style={styles.usageRow}>
              <Text style={styles.usageSubLabel}>Free Messages</Text>
              <Text style={styles.usageSubValue}>
                {guestChatsRemaining} of 5 remaining
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.usageRow}>
                <Text style={styles.usageSubLabel}>Free Trial</Text>
                <Text style={styles.usageSubValue}>
                  {user?.freeTrialMessages || 0} messages
                </Text>
              </View>
              <View style={styles.usageRow}>
                <Text style={styles.usageSubLabel}>Purchased Credits</Text>
                <Text style={styles.usageSubValue}>{user?.credits || 0}</Text>
              </View>
            </>
          )}
        </View>

        <Text style={styles.sectionTitle}>{isGuest ? "Get Started" : "Upgrade"}</Text>
        <Pressable
          onPress={() => isGuest ? router.push("/auth") : router.push("/credits")}
          style={({ pressed }) => [
            styles.upgradeCard,
            { opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <LinearGradient
            colors={[C.tint, C.accent]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.upgradeGradient}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.upgradeTitle}>{isGuest ? "Create Free Account" : "Get More Credits"}</Text>
              <Text style={styles.upgradeSubtitle}>
                {isGuest ? "Unlock image generation, voice cloning, and unlimited chat" : "Unlock unlimited AI conversations and voice cloning"}
              </Text>
            </View>
            <Ionicons name="arrow-forward-circle" size={32} color="#FFF" />
          </LinearGradient>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  scrollContent: { paddingHorizontal: 20 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  headerLeft: {},
  greeting: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: C.textSecondary,
  },
  userName: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
    color: C.text,
  },
  logoutBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  signUpBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    backgroundColor: C.tint,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  signUpBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#FFF",
  },
  guestBanner: {
    backgroundColor: C.tint + "12",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.tint + "30",
    marginBottom: 24,
  },
  guestBannerContent: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 16,
    gap: 12,
  },
  guestBannerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.tint + "20",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  guestBannerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: C.text,
    marginBottom: 2,
  },
  guestBannerText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textSecondary,
  },
  roleChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    backgroundColor: C.tint + "15",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 24,
  },
  roleText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: C.tint,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 28,
  },
  statCard: {
    width: "47%" as any,
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
    color: C.text,
  },
  statLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textSecondary,
  },
  mascotRow: {
    gap: 12,
    paddingBottom: 4,
    marginBottom: 24,
  },
  mascotCard: {
    width: 130,
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderWidth: 1.5,
    gap: 6,
  },
  mascotImgWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    overflow: "hidden",
  },
  mascotImg: {
    width: "100%",
    height: "100%",
  },
  mascotName: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
  },
  mascotTagline: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: C.textSecondary,
    textAlign: "center",
  },
  mascotChatBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    marginTop: 2,
  },
  mascotChatBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
  },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: C.text,
    marginBottom: 12,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 28,
  },
  actionCard: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
  },
  actionGradient: {
    padding: 16,
    alignItems: "center",
    gap: 8,
    borderRadius: 16,
  },
  actionLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: C.text,
  },
  usageCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    gap: 12,
    marginBottom: 28,
  },
  usageRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  usageLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: C.text,
  },
  usageValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: C.tint,
  },
  progressBar: {
    height: 6,
    backgroundColor: C.backgroundSecondary,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: C.tint,
    borderRadius: 3,
  },
  usageSubLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textSecondary,
  },
  usageSubValue: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: C.textSecondary,
  },
  upgradeCard: {
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 20,
  },
  upgradeGradient: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    borderRadius: 16,
    gap: 16,
  },
  upgradeTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: "#FFF",
    marginBottom: 4,
  },
  upgradeSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "rgba(255,255,255,0.8)",
  },
});
