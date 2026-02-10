import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  Pressable,
  TextInput,
  Platform,
  Alert,
  Modal,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/contexts/AuthContext";
import {
  AppUser,
  VoiceRequest,
  saveUser,
  getFreeTrialLimit,
  setFreeTrialLimit,
  getVoiceRequests,
  saveVoiceRequest,
  deleteVoiceRequest,
} from "@/lib/storage-helpers";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

const C = Colors.light;

interface AiProvider {
  id: string;
  name: string;
  type: "replit" | "openai" | "custom";
  apiKey?: string;
  baseUrl?: string;
  model: string;
  isActive: boolean;
}

interface GenConfig {
  provider: "openai" | "custom";
  apiKey: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
}

type AdminTab = "users" | "providers" | "generation" | "alerts" | "support" | "domains" | "voice";

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const { user, getAllUsers, deleteUser, updateUser } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [search, setSearch] = useState("");
  const [freeLimit, setFreeLimit] = useState("10");
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [editCredits, setEditCredits] = useState("");
  const [editTrialMessages, setEditTrialMessages] = useState("");
  const [editVoiceCredits, setEditVoiceCredits] = useState("");
  const [adminTab, setAdminTab] = useState<AdminTab>("users");

  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [editingProvider, setEditingProvider] = useState<AiProvider | null>(
    null
  );
  const [providerName, setProviderName] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerModel, setProviderModel] = useState("");
  const [providerType, setProviderType] = useState<"replit" | "openai" | "custom">("custom");
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [showAddProvider, setShowAddProvider] = useState(false);

  const [imageConfig, setImageConfig] = useState<GenConfig>({
    provider: "openai",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "dall-e-3",
    enabled: false,
  });
  const [videoConfig, setVideoConfig] = useState<GenConfig>({
    provider: "openai",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    enabled: false,
  });
  const [imageConfigSaved, setImageConfigSaved] = useState(false);
  const [videoConfigSaved, setVideoConfigSaved] = useState(false);

  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [supportMsgs, setSupportMsgs] = useState<any[]>([]);
  const [domainReqs, setDomainReqs] = useState<any[]>([]);
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [voiceRequests, setVoiceRequests] = useState<VoiceRequest[]>([]);

  const isAdmin = user?.role === "super_admin" || user?.role === "admin";

  const loadData = useCallback(async () => {
    const allUsers = await getAllUsers();
    setUsers(allUsers);
    const limit = await getFreeTrialLimit();
    setFreeLimit(limit.toString());
  }, [getAllUsers]);

  const loadProviders = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/providers");
      const data = await res.json();
      setProviders(data);
    } catch {}
  }, []);

  const loadGenConfigs = useCallback(async () => {
    try {
      const [imgRes, vidRes] = await Promise.all([
        apiRequest("GET", "/api/ai/image-config"),
        apiRequest("GET", "/api/ai/video-config"),
      ]);
      const imgData = await imgRes.json();
      const vidData = await vidRes.json();
      setImageConfig(imgData);
      setVideoConfig(vidData);
    } catch {}
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/admin/notifications");
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch {}
  }, []);

  const loadSupportMsgs = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/support/messages");
      const data = await res.json();
      setSupportMsgs(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  const loadDomainReqs = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/domains/requests");
      const data = await res.json();
      setDomainReqs(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  const loadVoiceRequests = useCallback(async () => {
    try {
      const all = await getVoiceRequests();
      setVoiceRequests(all);
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
      loadProviders();
      loadGenConfigs();
      loadNotifications();
      loadSupportMsgs();
      loadDomainReqs();
      loadVoiceRequests();
    }, [loadData, loadProviders, loadGenConfigs, loadNotifications, loadSupportMsgs, loadDomainReqs, loadVoiceRequests])
  );

  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleBlock = async (u: AppUser) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = { ...u, blocked: !u.blocked };
    await updateUser(updated);
    loadData();
  };

  const handleDelete = (u: AppUser) => {
    if (u.role === "super_admin") return;
    const doDelete = async () => {
      await deleteUser(u.id);
      loadData();
    };
    if (Platform.OS === "web") {
      doDelete();
    } else {
      Alert.alert("Delete User", `Remove ${u.email}?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const handleSetRole = async (u: AppUser, role: "admin" | "user") => {
    if (user?.role !== "super_admin") return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated = { ...u, role };
    await updateUser(updated);
    loadData();
  };

  const handleSaveTrialLimit = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await setFreeTrialLimit(parseInt(freeLimit) || 10);
  };

  const openUserModal = (u: AppUser) => {
    setSelectedUser(u);
    setEditCredits(u.credits.toString());
    setEditTrialMessages(u.freeTrialMessages.toString());
    setEditVoiceCredits((u.voiceCredits ?? 0).toString());
  };

  const handleSaveUserEdit = async () => {
    if (!selectedUser) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const updated: AppUser = {
      ...selectedUser,
      credits: parseInt(editCredits) || 0,
      freeTrialMessages: parseInt(editTrialMessages) || 0,
      voiceCredits: parseInt(editVoiceCredits) || 0,
    };
    await updateUser(updated);
    setSelectedUser(null);
    loadData();
  };

  const handleActivateProvider = async (id: string) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await apiRequest("PUT", `/api/providers/${id}/activate`);
      loadProviders();
    } catch {}
  };

  const handleTestProvider = async (id: string) => {
    setTestingProvider(id);
    setTestResult(null);
    try {
      const res = await apiRequest("POST", "/api/providers/test", {
        providerId: id,
      });
      const data = await res.json();
      setTestResult(data.success ? `OK: ${data.response}` : `Failed: ${data.error}`);
      Haptics.notificationAsync(
        data.success
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error
      );
    } catch (err: any) {
      setTestResult(`Error: ${err.message}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setTestingProvider(null);
    }
  };

  const handleEditProvider = (p: AiProvider) => {
    setEditingProvider(p);
    setProviderName(p.name);
    setProviderApiKey("");
    setProviderBaseUrl(p.baseUrl || "");
    setProviderModel(p.model);
    setProviderType(p.type);
  };

  const handleSaveProvider = async () => {
    if (!editingProvider) return;
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await apiRequest("PUT", `/api/providers/${editingProvider.id}`, {
        name: providerName,
        type: providerType,
        apiKey: providerApiKey || "***configured***",
        baseUrl: providerBaseUrl,
        model: providerModel,
        isActive: editingProvider.isActive,
      });
      setEditingProvider(null);
      loadProviders();
    } catch (err: any) {
      const msg = err.message || "Failed to save";
      if (Platform.OS === "web") alert(msg);
      else Alert.alert("Error", msg);
    }
  };

  const handleAddProvider = async () => {
    if (!providerName || !providerModel) return;
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const id =
        providerName.toLowerCase().replace(/[^a-z0-9]/g, "_") +
        "_" +
        Date.now();
      await apiRequest("POST", "/api/providers", {
        id,
        name: providerName,
        type: providerType,
        apiKey: providerApiKey,
        baseUrl: providerBaseUrl,
        model: providerModel,
        isActive: false,
      });
      setShowAddProvider(false);
      setProviderName("");
      setProviderApiKey("");
      setProviderBaseUrl("");
      setProviderModel("");
      loadProviders();
    } catch (err: any) {
      const msg = err.message || "Failed to add";
      if (Platform.OS === "web") alert(msg);
      else Alert.alert("Error", msg);
    }
  };

  const handleDeleteProvider = async (id: string) => {
    if (id === "replit") return;
    try {
      await apiRequest("DELETE", `/api/providers/${id}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      loadProviders();
    } catch {}
  };

  const handleSaveImageConfig = async () => {
    try {
      await apiRequest("PUT", "/api/ai/image-config", imageConfig);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setImageConfigSaved(true);
      setTimeout(() => setImageConfigSaved(false), 2000);
      loadGenConfigs();
    } catch (err: any) {
      const msg = err.message || "Failed to save";
      if (Platform.OS === "web") alert(msg);
      else Alert.alert("Error", msg);
    }
  };

  const handleSaveVideoConfig = async () => {
    try {
      await apiRequest("PUT", "/api/ai/video-config", videoConfig);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setVideoConfigSaved(true);
      setTimeout(() => setVideoConfigSaved(false), 2000);
      loadGenConfigs();
    } catch (err: any) {
      const msg = err.message || "Failed to save";
      if (Platform.OS === "web") alert(msg);
      else Alert.alert("Error", msg);
    }
  };

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  if (!isAdmin) {
    return (
      <View
        style={[
          styles.container,
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        <Ionicons name="shield-outline" size={48} color={C.textTertiary} />
        <Text style={styles.noAccessTitle}>Admin Access Required</Text>
        <Text style={styles.noAccessText}>
          Contact your administrator for access
        </Text>
      </View>
    );
  }

  const renderProvider = (p: AiProvider) => (
    <View key={p.id} style={styles.providerCard}>
      <View style={styles.providerHeader}>
        <View style={styles.providerLeft}>
          <View
            style={[
              styles.providerIcon,
              {
                backgroundColor:
                  p.type === "replit"
                    ? C.tint + "20"
                    : p.type === "openai"
                      ? C.success + "20"
                      : C.purple + "20",
              },
            ]}
          >
            <Ionicons
              name={
                p.type === "replit"
                  ? "sparkles"
                  : p.type === "openai"
                    ? "logo-electron"
                    : "server"
              }
              size={18}
              color={
                p.type === "replit"
                  ? C.tint
                  : p.type === "openai"
                    ? C.success
                    : C.purple
              }
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.providerName}>{p.name}</Text>
            <Text style={styles.providerModel}>Model: {p.model}</Text>
            {p.type !== "replit" && (
              <Text style={styles.providerApiStatus}>
                API Key: {p.apiKey ? "Configured" : "Not set"}
              </Text>
            )}
          </View>
        </View>
        {p.isActive && (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>Active</Text>
          </View>
        )}
      </View>

      <View style={styles.providerActions}>
        {!p.isActive && (
          <Pressable
            onPress={() => handleActivateProvider(p.id)}
            style={({ pressed }) => [
              styles.providerActionBtn,
              styles.activateBtn,
              { opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Ionicons name="checkmark-circle" size={14} color={C.tint} />
            <Text style={[styles.providerActionText, { color: C.tint }]}>
              Activate
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => handleTestProvider(p.id)}
          disabled={testingProvider === p.id}
          style={({ pressed }) => [
            styles.providerActionBtn,
            { opacity: pressed || testingProvider === p.id ? 0.6 : 1 },
          ]}
        >
          {testingProvider === p.id ? (
            <ActivityIndicator size="small" color={C.accent} />
          ) : (
            <>
              <Ionicons name="flash" size={14} color={C.accent} />
              <Text style={[styles.providerActionText, { color: C.accent }]}>
                Test
              </Text>
            </>
          )}
        </Pressable>
        <Pressable
          onPress={() => handleEditProvider(p)}
          style={({ pressed }) => [
            styles.providerActionBtn,
            { opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Ionicons name="pencil" size={14} color={C.textSecondary} />
          <Text style={styles.providerActionText}>Edit</Text>
        </Pressable>
        {p.type !== "replit" && (
          <Pressable
            onPress={() => handleDeleteProvider(p.id)}
            style={({ pressed }) => [
              styles.providerActionBtn,
              { opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Ionicons name="trash" size={14} color={C.danger} />
          </Pressable>
        )}
      </View>

      {testResult && testingProvider === null && (
        <Text
          style={[
            styles.testResultText,
            {
              color: testResult.startsWith("OK") ? C.success : C.danger,
            },
          ]}
        >
          {testResult}
        </Text>
      )}
    </View>
  );

  const renderUser = ({ item }: { item: AppUser }) => (
    <Pressable
      onPress={() => openUserModal(item)}
      style={({ pressed }) => [
        styles.userCard,
        { opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <View style={styles.userLeft}>
        <View
          style={[
            styles.userAvatar,
            {
              backgroundColor:
                item.role === "super_admin"
                  ? C.tint + "20"
                  : item.role === "admin"
                    ? C.purple + "20"
                    : C.accent + "20",
            },
          ]}
        >
          <Ionicons
            name={
              item.role === "super_admin"
                ? "shield-checkmark"
                : item.role === "admin"
                  ? "shield"
                  : "person"
            }
            size={18}
            color={
              item.role === "super_admin"
                ? C.tint
                : item.role === "admin"
                  ? C.purple
                  : C.accent
            }
          />
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.userEmail} numberOfLines={1}>
            {item.email}
          </Text>
          <View style={styles.userMeta}>
            <Text style={styles.userMetaText}>Credits: {item.credits}</Text>
            <Text style={[styles.userMetaText, { color: "#7c3aed" }]}>VC: {item.voiceCredits ?? 0}</Text>
            <Text style={styles.userMetaText}>
              Used: {item.usedMessages}/{item.freeTrialMessages}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.userRight}>
        {item.blocked && (
          <View style={styles.blockedChip}>
            <Text style={styles.blockedText}>Blocked</Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={16} color={C.textTertiary} />
      </View>
    </Pressable>
  );

  const providerFormContent = (
    <View style={styles.providerForm}>
      <View style={styles.modalField}>
        <Text style={styles.modalFieldLabel}>Provider Type</Text>
        <View style={styles.roleRow}>
          {(["openai", "custom"] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setProviderType(t)}
              style={[
                styles.roleBtn,
                providerType === t && styles.roleBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.roleBtnText,
                  providerType === t && styles.roleBtnTextActive,
                ]}
              >
                {t === "openai" ? "Standard" : "Custom"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.modalField}>
        <Text style={styles.modalFieldLabel}>Name</Text>
        <TextInput
          style={styles.modalInput}
          value={providerName}
          onChangeText={setProviderName}
          placeholder="e.g. GPT-4o AI Engine"
          placeholderTextColor={C.placeholder}
        />
      </View>

      <View style={styles.modalField}>
        <Text style={styles.modalFieldLabel}>API Key</Text>
        <TextInput
          style={styles.modalInput}
          value={providerApiKey}
          onChangeText={setProviderApiKey}
          placeholder={
            editingProvider ? "Leave blank to keep current" : "sk-..."
          }
          placeholderTextColor={C.placeholder}
          secureTextEntry
          autoCapitalize="none"
        />
      </View>

      {providerType === "custom" && (
        <View style={styles.modalField}>
          <Text style={styles.modalFieldLabel}>Base URL</Text>
          <TextInput
            style={styles.modalInput}
            value={providerBaseUrl}
            onChangeText={setProviderBaseUrl}
            placeholder="https://api.example.com/v1"
            placeholderTextColor={C.placeholder}
            autoCapitalize="none"
          />
          <Text style={styles.providerHint}>
            Compatible API endpoint URL
          </Text>
        </View>
      )}

      <View style={styles.modalField}>
        <Text style={styles.modalFieldLabel}>Model</Text>
        <TextInput
          style={styles.modalInput}
          value={providerModel}
          onChangeText={setProviderModel}
          placeholder="e.g. gpt-4o-mini, gpt-4o, claude-3.5-sonnet"
          placeholderTextColor={C.placeholder}
          autoCapitalize="none"
        />
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.headerBar, { paddingTop: topInset + 8 }]}>
        <Text style={styles.headerTitle}>Admin Panel</Text>
        <View style={styles.headerBadge}>
          <Text style={styles.headerBadgeText}>
            {user?.role === "super_admin" ? "Super Admin" : "Admin"}
          </Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.adminTabRow} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        <Pressable
          onPress={() => setAdminTab("users")}
          style={[
            styles.adminTabBtn,
            adminTab === "users" && styles.adminTabBtnActive,
          ]}
        >
          <Ionicons
            name="people"
            size={16}
            color={adminTab === "users" ? C.tint : C.textSecondary}
          />
          <Text
            style={[
              styles.adminTabText,
              adminTab === "users" && styles.adminTabTextActive,
            ]}
          >
            Users
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setAdminTab("providers")}
          style={[
            styles.adminTabBtn,
            adminTab === "providers" && styles.adminTabBtnActive,
          ]}
        >
          <Ionicons
            name="cube"
            size={16}
            color={adminTab === "providers" ? C.tint : C.textSecondary}
          />
          <Text
            style={[
              styles.adminTabText,
              adminTab === "providers" && styles.adminTabTextActive,
            ]}
          >
            AI Providers
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setAdminTab("generation")}
          style={[
            styles.adminTabBtn,
            adminTab === "generation" && styles.adminTabBtnActive,
          ]}
        >
          <Ionicons
            name="color-wand"
            size={16}
            color={adminTab === "generation" ? C.tint : C.textSecondary}
          />
          <Text
            style={[
              styles.adminTabText,
              adminTab === "generation" && styles.adminTabTextActive,
            ]}
          >
            Generation
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { setAdminTab("alerts"); loadNotifications(); }}
          style={[
            styles.adminTabBtn,
            adminTab === "alerts" && styles.adminTabBtnActive,
          ]}
        >
          <View style={{ position: "relative" }}>
            <Ionicons
              name="notifications"
              size={16}
              color={adminTab === "alerts" ? C.tint : C.textSecondary}
            />
            {unreadCount > 0 && (
              <View style={{ position: "absolute", top: -4, right: -6, backgroundColor: C.danger, borderRadius: 6, width: 12, height: 12, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontSize: 8, fontWeight: "700" as const }}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
              </View>
            )}
          </View>
          <Text
            style={[
              styles.adminTabText,
              adminTab === "alerts" && styles.adminTabTextActive,
            ]}
          >
            Alerts
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { setAdminTab("support"); loadSupportMsgs(); }}
          style={[
            styles.adminTabBtn,
            adminTab === "support" && styles.adminTabBtnActive,
          ]}
        >
          <Ionicons
            name="chatbubbles"
            size={16}
            color={adminTab === "support" ? C.tint : C.textSecondary}
          />
          <Text
            style={[
              styles.adminTabText,
              adminTab === "support" && styles.adminTabTextActive,
            ]}
          >
            Support
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { setAdminTab("domains"); loadDomainReqs(); }}
          style={[
            styles.adminTabBtn,
            adminTab === "domains" && styles.adminTabBtnActive,
          ]}
        >
          <Ionicons
            name="globe"
            size={16}
            color={adminTab === "domains" ? C.tint : C.textSecondary}
          />
          <Text
            style={[
              styles.adminTabText,
              adminTab === "domains" && styles.adminTabTextActive,
            ]}
          >
            Domains
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { setAdminTab("voice"); loadVoiceRequests(); }}
          style={[
            styles.adminTabBtn,
            adminTab === "voice" && styles.adminTabBtnActive,
          ]}
        >
          <Ionicons
            name="mic"
            size={16}
            color={adminTab === "voice" ? C.tint : C.textSecondary}
          />
          <Text
            style={[
              styles.adminTabText,
              adminTab === "voice" && styles.adminTabTextActive,
            ]}
          >
            Voice
          </Text>
        </Pressable>
      </ScrollView>

      {adminTab === "users" ? (
        <FlatList
          data={filteredUsers}
          keyExtractor={(item) => item.id}
          renderItem={renderUser}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <View style={styles.trialCard}>
                <Text style={styles.trialLabel}>
                  Free Trial Messages Limit
                </Text>
                <View style={styles.trialRow}>
                  <TextInput
                    style={styles.trialInput}
                    value={freeLimit}
                    onChangeText={setFreeLimit}
                    keyboardType="numeric"
                    placeholderTextColor={C.placeholder}
                  />
                  <Pressable
                    onPress={handleSaveTrialLimit}
                    style={({ pressed }) => [
                      styles.trialSaveBtn,
                      { opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <Ionicons name="checkmark" size={18} color="#FFF" />
                  </Pressable>
                </View>
                <Text style={styles.trialHint}>
                  New users will receive this many free messages
                </Text>
              </View>

              <View style={styles.searchBox}>
                <Ionicons name="search" size={18} color={C.textSecondary} />
                <TextInput
                  style={styles.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search users..."
                  placeholderTextColor={C.placeholder}
                />
              </View>

              <Text style={styles.userCount}>
                {filteredUsers.length} user
                {filteredUsers.length !== 1 ? "s" : ""}
              </Text>
            </View>
          }
        />
      ) : adminTab === "providers" ? (
        <ScrollView
          contentContainerStyle={styles.providerList}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.providerInfoCard}>
            <Ionicons name="information-circle" size={18} color={C.accent} />
            <Text style={styles.providerInfoText}>
              Configure which AI provider powers the chat and receptionist.
              The active provider is used for all AI features including
              incoming call handling.
            </Text>
          </View>

          {providers.map(renderProvider)}

          {!showAddProvider ? (
            <Pressable
              onPress={() => {
                setShowAddProvider(true);
                setProviderName("");
                setProviderApiKey("");
                setProviderBaseUrl("");
                setProviderModel("");
                setProviderType("custom");
              }}
              style={({ pressed }) => [
                styles.addProviderBtn,
                { opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Ionicons name="add-circle" size={20} color={C.tint} />
              <Text style={styles.addProviderText}>Add New Provider</Text>
            </Pressable>
          ) : (
            <View style={styles.addProviderCard}>
              <View style={styles.addProviderHeader}>
                <Text style={styles.addProviderTitle}>New AI Provider</Text>
                <Pressable onPress={() => setShowAddProvider(false)}>
                  <Ionicons name="close" size={22} color={C.textSecondary} />
                </Pressable>
              </View>
              {providerFormContent}
              <Pressable
                onPress={handleAddProvider}
                style={({ pressed }) => [
                  styles.modalSaveBtn,
                  { opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Text style={styles.modalSaveBtnText}>Add Provider</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      ) : null}

      {adminTab === "generation" && (
        <ScrollView
          contentContainerStyle={styles.providerList}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.genSectionTitle}>Image Generation</Text>

          <View style={styles.providerInfoCard}>
            <Ionicons name="information-circle" size={18} color={C.accent} />
            <Text style={styles.providerInfoText}>
              Configure the API for image generation. Requires an API
              key with image generation access, or a compatible
              endpoint.
            </Text>
          </View>

          <View style={styles.genCard}>
            <View style={styles.genToggleRow}>
              <Text style={styles.genToggleLabel}>Enabled</Text>
              <Pressable
                onPress={() =>
                  setImageConfig((c) => ({ ...c, enabled: !c.enabled }))
                }
                style={[
                  styles.genToggle,
                  imageConfig.enabled && styles.genToggleActive,
                ]}
              >
                <View
                  style={[
                    styles.genToggleThumb,
                    imageConfig.enabled && styles.genToggleThumbActive,
                  ]}
                />
              </Pressable>
            </View>

            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabel}>Provider</Text>
              <View style={styles.roleRow}>
                {(["openai", "custom"] as const).map((t) => (
                  <Pressable
                    key={t}
                    onPress={() =>
                      setImageConfig((c) => ({ ...c, provider: t }))
                    }
                    style={[
                      styles.roleBtn,
                      imageConfig.provider === t && styles.roleBtnActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.roleBtnText,
                        imageConfig.provider === t && styles.roleBtnTextActive,
                      ]}
                    >
                      {t === "openai" ? "Standard" : "Custom"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabel}>API Key</Text>
              <TextInput
                style={styles.modalInput}
                value={imageConfig.apiKey}
                onChangeText={(v) =>
                  setImageConfig((c) => ({ ...c, apiKey: v }))
                }
                placeholder="sk-..."
                placeholderTextColor={C.placeholder}
                secureTextEntry
                autoCapitalize="none"
              />
            </View>

            {imageConfig.provider === "custom" && (
              <View style={styles.modalField}>
                <Text style={styles.modalFieldLabel}>Base URL</Text>
                <TextInput
                  style={styles.modalInput}
                  value={imageConfig.baseUrl}
                  onChangeText={(v) =>
                    setImageConfig((c) => ({ ...c, baseUrl: v }))
                  }
                  placeholder="https://api.example.com/v1"
                  placeholderTextColor={C.placeholder}
                  autoCapitalize="none"
                />
              </View>
            )}

            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabel}>Model</Text>
              <TextInput
                style={styles.modalInput}
                value={imageConfig.model}
                onChangeText={(v) =>
                  setImageConfig((c) => ({ ...c, model: v }))
                }
                placeholder="image-model-3"
                placeholderTextColor={C.placeholder}
                autoCapitalize="none"
              />
            </View>

            <Pressable
              onPress={handleSaveImageConfig}
              style={({ pressed }) => [
                styles.modalSaveBtn,
                { opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.modalSaveBtnText}>
                {imageConfigSaved ? "Saved!" : "Save Image Config"}
              </Text>
            </Pressable>
          </View>

          <Text style={[styles.genSectionTitle, { marginTop: 8 }]}>
            Video Generation
          </Text>

          <View style={styles.providerInfoCard}>
            <Ionicons name="information-circle" size={18} color={C.accent} />
            <Text style={styles.providerInfoText}>
              Configure the API for video generation. Requires a
              compatible API key.
            </Text>
          </View>

          <View style={styles.genCard}>
            <View style={styles.genToggleRow}>
              <Text style={styles.genToggleLabel}>Enabled</Text>
              <Pressable
                onPress={() =>
                  setVideoConfig((c) => ({ ...c, enabled: !c.enabled }))
                }
                style={[
                  styles.genToggle,
                  videoConfig.enabled && styles.genToggleActive,
                ]}
              >
                <View
                  style={[
                    styles.genToggleThumb,
                    videoConfig.enabled && styles.genToggleThumbActive,
                  ]}
                />
              </Pressable>
            </View>

            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabel}>Provider</Text>
              <View style={styles.roleRow}>
                {(["openai", "custom"] as const).map((t) => (
                  <Pressable
                    key={t}
                    onPress={() =>
                      setVideoConfig((c) => ({ ...c, provider: t }))
                    }
                    style={[
                      styles.roleBtn,
                      videoConfig.provider === t && styles.roleBtnActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.roleBtnText,
                        videoConfig.provider === t && styles.roleBtnTextActive,
                      ]}
                    >
                      {t === "openai" ? "Standard" : "Custom"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabel}>API Key</Text>
              <TextInput
                style={styles.modalInput}
                value={videoConfig.apiKey}
                onChangeText={(v) =>
                  setVideoConfig((c) => ({ ...c, apiKey: v }))
                }
                placeholder="sk-..."
                placeholderTextColor={C.placeholder}
                secureTextEntry
                autoCapitalize="none"
              />
            </View>

            {videoConfig.provider === "custom" && (
              <View style={styles.modalField}>
                <Text style={styles.modalFieldLabel}>Base URL</Text>
                <TextInput
                  style={styles.modalInput}
                  value={videoConfig.baseUrl}
                  onChangeText={(v) =>
                    setVideoConfig((c) => ({ ...c, baseUrl: v }))
                  }
                  placeholder="https://api.example.com/v1"
                  placeholderTextColor={C.placeholder}
                  autoCapitalize="none"
                />
              </View>
            )}

            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabel}>Model</Text>
              <TextInput
                style={styles.modalInput}
                value={videoConfig.model}
                onChangeText={(v) =>
                  setVideoConfig((c) => ({ ...c, model: v }))
                }
                placeholder="video-model"
                placeholderTextColor={C.placeholder}
                autoCapitalize="none"
              />
            </View>

            <Pressable
              onPress={handleSaveVideoConfig}
              style={({ pressed }) => [
                styles.modalSaveBtn,
                { opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.modalSaveBtnText}>
                {videoConfigSaved ? "Saved!" : "Save Video Config"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      {adminTab === "alerts" && (
        <ScrollView contentContainerStyle={styles.providerList} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <Text style={styles.genSectionTitle}>Notifications</Text>
            {unreadCount > 0 && (
              <Pressable
                onPress={async () => {
                  try {
                    await apiRequest("POST", "/api/admin/notifications/read-all");
                    setUnreadCount(0);
                    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
                  } catch {}
                }}
                style={{ backgroundColor: C.tint, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
              >
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" as const }}>Mark All Read</Text>
              </Pressable>
            )}
          </View>
          {notifications.length === 0 ? (
            <View style={{ alignItems: "center", paddingTop: 40 }}>
              <Ionicons name="notifications-off-outline" size={40} color={C.textTertiary} />
              <Text style={{ color: C.textSecondary, marginTop: 12 }}>No notifications yet</Text>
            </View>
          ) : (
            notifications.map((n: any) => (
              <Pressable
                key={n.id}
                onPress={async () => {
                  if (!n.read) {
                    try {
                      await apiRequest("POST", `/api/admin/notifications/${n.id}/read`);
                      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
                      setUnreadCount(c => Math.max(0, c - 1));
                    } catch {}
                  }
                }}
                style={[styles.providerCard, !n.read && { borderLeftWidth: 3, borderLeftColor: C.tint }]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Ionicons
                    name={n.type === "domain_purchase" ? "globe" : n.type === "support_message" ? "chatbubble" : n.type === "deploy" ? "rocket" : n.type === "credit_purchase" ? "card" : "person-add"}
                    size={16}
                    color={n.type === "domain_purchase" ? C.purple : n.type === "support_message" ? C.accent : C.tint}
                  />
                  <Text style={[styles.providerName, { flex: 1 }]}>{n.title}</Text>
                  {!n.read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.tint }} />}
                </View>
                <Text style={{ color: C.textSecondary, fontSize: 13, lineHeight: 18 }}>{n.message}</Text>
                <Text style={{ color: C.textTertiary, fontSize: 11, marginTop: 6 }}>
                  {new Date(n.createdAt).toLocaleString()}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      {adminTab === "support" && (
        <ScrollView contentContainerStyle={styles.providerList} showsVerticalScrollIndicator={false}>
          <Text style={styles.genSectionTitle}>Support Messages</Text>
          {supportMsgs.length === 0 ? (
            <View style={{ alignItems: "center", paddingTop: 40 }}>
              <Ionicons name="chatbubbles-outline" size={40} color={C.textTertiary} />
              <Text style={{ color: C.textSecondary, marginTop: 12 }}>No support messages</Text>
            </View>
          ) : (
            supportMsgs.map((msg: any) => (
              <View key={msg.id} style={styles.providerCard}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <View style={{
                    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
                    backgroundColor: msg.status === "open" ? C.warning + "30" : msg.status === "resolved" ? C.success + "30" : C.accent + "30",
                  }}>
                    <Text style={{ fontSize: 10, fontWeight: "600" as const, color: msg.status === "open" ? C.warning : msg.status === "resolved" ? C.success : C.accent }}>
                      {msg.status.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[styles.providerName, { flex: 1 }]}>{msg.subject}</Text>
                </View>
                <Text style={{ color: C.textSecondary, fontSize: 12, marginBottom: 4 }}>
                  From: {msg.userName} ({msg.userEmail})
                </Text>
                <Text style={{ color: C.text, fontSize: 13, lineHeight: 18, marginBottom: 8 }}>{msg.message}</Text>
                {msg.adminReply && (
                  <View style={{ backgroundColor: C.backgroundSecondary, padding: 10, borderRadius: 8, marginBottom: 8 }}>
                    <Text style={{ color: C.tint, fontSize: 11, fontWeight: "600" as const, marginBottom: 4 }}>Admin Reply:</Text>
                    <Text style={{ color: C.text, fontSize: 13 }}>{msg.adminReply}</Text>
                  </View>
                )}
                {replyingTo === msg.id ? (
                  <View>
                    <TextInput
                      style={[styles.modalInput, { marginBottom: 8 }]}
                      value={replyText}
                      onChangeText={setReplyText}
                      placeholder="Type your reply..."
                      placeholderTextColor={C.placeholder}
                      multiline
                    />
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable
                        onPress={async () => {
                          if (!replyText.trim()) return;
                          try {
                            await apiRequest("PUT", `/api/support/messages/${msg.id}`, {
                              adminReply: replyText.trim(),
                              status: "resolved",
                            });
                            setReplyText("");
                            setReplyingTo(null);
                            loadSupportMsgs();
                          } catch {}
                        }}
                        style={[styles.modalSaveBtn, { flex: 1, paddingVertical: 8 }]}
                      >
                        <Text style={styles.modalSaveBtnText}>Send Reply</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => { setReplyingTo(null); setReplyText(""); }}
                        style={{ paddingVertical: 8, paddingHorizontal: 12 }}
                      >
                        <Text style={{ color: C.textSecondary }}>Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable
                      onPress={() => { setReplyingTo(msg.id); setReplyText(msg.adminReply || ""); }}
                      style={{ backgroundColor: C.accent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 }}
                    >
                      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" as const }}>Reply</Text>
                    </Pressable>
                    {msg.status !== "resolved" && (
                      <Pressable
                        onPress={async () => {
                          try {
                            await apiRequest("PUT", `/api/support/messages/${msg.id}`, { status: "resolved" });
                            loadSupportMsgs();
                          } catch {}
                        }}
                        style={{ backgroundColor: C.success, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 }}
                      >
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" as const }}>Resolve</Text>
                      </Pressable>
                    )}
                  </View>
                )}
                <Text style={{ color: C.textTertiary, fontSize: 11, marginTop: 8 }}>
                  {new Date(msg.createdAt).toLocaleString()}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {adminTab === "domains" && (
        <ScrollView contentContainerStyle={styles.providerList} showsVerticalScrollIndicator={false}>
          <Text style={styles.genSectionTitle}>Domain Requests</Text>
          {domainReqs.length === 0 ? (
            <View style={{ alignItems: "center", paddingTop: 40 }}>
              <Ionicons name="globe-outline" size={40} color={C.textTertiary} />
              <Text style={{ color: C.textSecondary, marginTop: 12 }}>No domain requests yet</Text>
            </View>
          ) : (
            domainReqs.map((req: any) => (
              <View key={req.id} style={styles.providerCard}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Ionicons name="globe" size={18} color={C.purple} />
                  <Text style={[styles.providerName, { flex: 1 }]}>{req.domain}</Text>
                  <View style={{
                    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
                    backgroundColor: req.status === "pending" ? C.warning + "30" : req.status === "completed" ? C.success + "30" : C.accent + "30",
                  }}>
                    <Text style={{ fontSize: 10, fontWeight: "600" as const, color: req.status === "pending" ? C.warning : req.status === "completed" ? C.success : C.accent }}>
                      {req.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text style={{ color: C.textSecondary, fontSize: 12 }}>
                  Requested by: {req.userName} ({req.userEmail})
                </Text>
                {req.paypalTransactionId && (
                  <Text style={{ color: C.tint, fontSize: 12, marginTop: 4 }}>
                    PayPal TX: {req.paypalTransactionId}
                  </Text>
                )}
                <Text style={{ color: C.textTertiary, fontSize: 11, marginTop: 4 }}>
                  {new Date(req.createdAt).toLocaleString()}
                </Text>
                {req.status === "pending" && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                    <Pressable
                      onPress={async () => {
                        try {
                          await apiRequest("PUT", `/api/domains/requests/${req.id}`, { status: "approved" });
                          loadDomainReqs();
                        } catch {}
                      }}
                      style={{ backgroundColor: C.success, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 }}
                    >
                      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" as const }}>Approve</Text>
                    </Pressable>
                    <Pressable
                      onPress={async () => {
                        try {
                          await apiRequest("PUT", `/api/domains/requests/${req.id}`, { status: "rejected" });
                          loadDomainReqs();
                        } catch {}
                      }}
                      style={{ backgroundColor: C.danger, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 }}
                    >
                      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" as const }}>Reject</Text>
                    </Pressable>
                    <Pressable
                      onPress={async () => {
                        try {
                          await apiRequest("PUT", `/api/domains/requests/${req.id}`, { status: "completed" });
                          loadDomainReqs();
                        } catch {}
                      }}
                      style={{ backgroundColor: C.tint, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 }}
                    >
                      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" as const }}>Complete</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))
          )}
        </ScrollView>
      )}

      {adminTab === "voice" && (
        <ScrollView contentContainerStyle={styles.providerList} showsVerticalScrollIndicator={false}>
          <Text style={styles.genSectionTitle}>Voice Clone Requests</Text>
          {voiceRequests.length === 0 ? (
            <View style={{ alignItems: "center", paddingTop: 40 }}>
              <Ionicons name="mic-outline" size={40} color={C.textTertiary} />
              <Text style={{ color: C.textSecondary, marginTop: 12 }}>No voice requests yet</Text>
            </View>
          ) : (
            voiceRequests.map((req) => (
              <View key={req.id} style={styles.providerCard}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Ionicons name="mic" size={18} color={C.purple} />
                  <Text style={[styles.providerName, { flex: 1 }]}>{req.userName}</Text>
                  <View style={{
                    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
                    backgroundColor: req.status === "pending" ? C.warning + "30" : req.status === "complete" ? C.success + "30" : C.accent + "30",
                  }}>
                    <Text style={{ fontSize: 10, fontWeight: "600" as const, color: req.status === "pending" ? C.warning : req.status === "complete" ? C.success : C.accent }}>
                      {req.status.toUpperCase().replace("_", " ")}
                    </Text>
                  </View>
                </View>
                <Text style={{ color: C.textSecondary, fontSize: 12 }}>
                  {req.userEmail}
                </Text>
                <Text style={{ color: C.text, fontSize: 12, marginTop: 6 }}>
                  Prompt: {req.prompt}
                </Text>
                {req.assignedNumber ? (
                  <Text style={{ color: C.tint, fontSize: 12, marginTop: 4 }}>
                    Number: {req.assignedNumber}
                  </Text>
                ) : null}
                <Text style={{ color: C.textTertiary, fontSize: 11, marginTop: 4 }}>
                  {new Date(req.createdAt).toLocaleString()}
                </Text>
                <Text style={{ color: C.textSecondary, fontSize: 11, marginTop: 2 }}>
                  Voice: {req.voiceFileName}
                </Text>
                {req.status === "pending" && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                    <Pressable
                      onPress={async () => {
                        const updated = { ...req, status: "in_progress" as const };
                        await saveVoiceRequest(updated);
                        loadVoiceRequests();
                      }}
                      style={{ backgroundColor: C.accent, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 }}
                    >
                      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" as const }}>In Progress</Text>
                    </Pressable>
                    <Pressable
                      onPress={async () => {
                        const updated = { ...req, status: "complete" as const };
                        await saveVoiceRequest(updated);
                        loadVoiceRequests();
                      }}
                      style={{ backgroundColor: C.success, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 }}
                    >
                      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" as const }}>Complete</Text>
                    </Pressable>
                    <Pressable
                      onPress={async () => {
                        await deleteVoiceRequest(req.id);
                        loadVoiceRequests();
                      }}
                      style={{ backgroundColor: C.danger, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 }}
                    >
                      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" as const }}>Delete</Text>
                    </Pressable>
                  </View>
                )}
                {req.status === "in_progress" && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                    <Pressable
                      onPress={async () => {
                        const updated = { ...req, status: "complete" as const };
                        await saveVoiceRequest(updated);
                        loadVoiceRequests();
                      }}
                      style={{ backgroundColor: C.success, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 }}
                    >
                      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" as const }}>Complete</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Modal
        visible={!!selectedUser}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedUser(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit User</Text>
              <Pressable onPress={() => setSelectedUser(null)}>
                <Ionicons name="close" size={24} color={C.text} />
              </Pressable>
            </View>

            {selectedUser && (
              <View style={styles.modalBody}>
                <Text style={styles.modalUserName}>{selectedUser.name}</Text>
                <Text style={styles.modalUserEmail}>
                  {selectedUser.email}
                </Text>

                <View style={styles.modalField}>
                  <Text style={styles.modalFieldLabel}>Credits</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={editCredits}
                    onChangeText={setEditCredits}
                    keyboardType="numeric"
                    placeholderTextColor={C.placeholder}
                  />
                </View>

                <View style={styles.modalField}>
                  <Text style={styles.modalFieldLabel}>
                    Free Trial Messages
                  </Text>
                  <TextInput
                    style={styles.modalInput}
                    value={editTrialMessages}
                    onChangeText={setEditTrialMessages}
                    keyboardType="numeric"
                    placeholderTextColor={C.placeholder}
                  />
                </View>

                <View style={styles.modalField}>
                  <Text style={styles.modalFieldLabel}>
                    Voice Credits (VC)
                  </Text>
                  <TextInput
                    style={[styles.modalInput, { borderColor: "#7c3aed" }]}
                    value={editVoiceCredits}
                    onChangeText={setEditVoiceCredits}
                    keyboardType="numeric"
                    placeholderTextColor={C.placeholder}
                    placeholder="0"
                  />
                  <Text style={{ fontSize: 10, color: C.textTertiary, marginTop: 2 }}>
                    5 VC per number, 50 VC per agent
                  </Text>
                </View>

                {user?.role === "super_admin" &&
                  selectedUser.role !== "super_admin" && (
                    <View style={styles.modalField}>
                      <Text style={styles.modalFieldLabel}>Role</Text>
                      <View style={styles.roleRow}>
                        <Pressable
                          onPress={() =>
                            handleSetRole(selectedUser, "admin")
                          }
                          style={[
                            styles.roleBtn,
                            selectedUser.role === "admin" &&
                              styles.roleBtnActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.roleBtnText,
                              selectedUser.role === "admin" &&
                                styles.roleBtnTextActive,
                            ]}
                          >
                            Admin
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() =>
                            handleSetRole(selectedUser, "user")
                          }
                          style={[
                            styles.roleBtn,
                            selectedUser.role === "user" &&
                              styles.roleBtnActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.roleBtnText,
                              selectedUser.role === "user" &&
                                styles.roleBtnTextActive,
                            ]}
                          >
                            User
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  )}

                <View style={styles.modalActions}>
                  <Pressable
                    onPress={() => handleBlock(selectedUser)}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      {
                        backgroundColor: selectedUser.blocked
                          ? C.success + "15"
                          : C.warning + "15",
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name={selectedUser.blocked ? "lock-open" : "ban"}
                      size={18}
                      color={selectedUser.blocked ? C.success : C.warning}
                    />
                    <Text
                      style={[
                        styles.actionBtnText,
                        {
                          color: selectedUser.blocked ? C.success : C.warning,
                        },
                      ]}
                    >
                      {selectedUser.blocked ? "Unblock" : "Block"}
                    </Text>
                  </Pressable>

                  {selectedUser.role !== "super_admin" && (
                    <Pressable
                      onPress={() => {
                        handleDelete(selectedUser);
                        setSelectedUser(null);
                      }}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        {
                          backgroundColor: C.danger + "15",
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <Ionicons name="trash" size={18} color={C.danger} />
                      <Text
                        style={[styles.actionBtnText, { color: C.danger }]}
                      >
                        Delete
                      </Text>
                    </Pressable>
                  )}
                </View>

                <Pressable
                  onPress={handleSaveUserEdit}
                  style={({ pressed }) => [
                    styles.modalSaveBtn,
                    { opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <Text style={styles.modalSaveBtnText}>Save Changes</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!editingProvider}
        animationType="slide"
        transparent
        onRequestClose={() => setEditingProvider(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Provider</Text>
              <Pressable onPress={() => setEditingProvider(null)}>
                <Ionicons name="close" size={24} color={C.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalBody}>
              {providerFormContent}
              <Pressable
                onPress={handleSaveProvider}
                style={({ pressed }) => [
                  styles.modalSaveBtn,
                  { marginBottom: 20, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Text style={styles.modalSaveBtnText}>Save Provider</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  headerBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: C.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    color: C.text,
  },
  headerBadge: {
    backgroundColor: C.tint + "20",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  headerBadgeText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: C.tint,
  },
  adminTabRow: {
    flexDirection: "row",
    paddingVertical: 12,
    maxHeight: 52,
  },
  adminTabBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: "transparent",
  },
  adminTabBtnActive: {
    borderColor: C.tint,
    backgroundColor: C.tint + "10",
  },
  adminTabText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: C.textSecondary,
  },
  adminTabTextActive: {
    color: C.tint,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  listHeader: { gap: 12, paddingBottom: 4 },
  trialCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  trialLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
  trialRow: {
    flexDirection: "row",
    gap: 8,
  },
  trialInput: {
    flex: 1,
    backgroundColor: C.inputBackground,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.inputBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontFamily: "Inter_500Medium",
    fontSize: 16,
  },
  trialSaveBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: C.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  trialHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: C.textTertiary,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    color: C.text,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  userCount: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: C.textSecondary,
  },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    marginVertical: 4,
  },
  userLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  userAvatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  userInfo: { flex: 1, gap: 2 },
  userName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
  userEmail: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textSecondary,
  },
  userMeta: {
    flexDirection: "row",
    gap: 12,
    marginTop: 2,
  },
  userMetaText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: C.textTertiary,
  },
  userRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  blockedChip: {
    backgroundColor: C.danger + "20",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  blockedText: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    color: C.danger,
  },
  noAccessTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
    color: C.text,
    marginTop: 16,
  },
  noAccessText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: C.textSecondary,
    marginTop: 4,
  },
  providerList: {
    paddingHorizontal: 16,
    paddingBottom: 100,
    gap: 12,
  },
  providerInfoCard: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: C.accent + "10",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.accent + "30",
  },
  providerInfoText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 18,
  },
  providerCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  providerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  providerLeft: {
    flexDirection: "row",
    gap: 12,
    flex: 1,
  },
  providerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  providerName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
  providerModel: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  providerApiStatus: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: C.textTertiary,
    marginTop: 2,
  },
  providerHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: C.textTertiary,
    marginTop: 2,
  },
  activeBadge: {
    backgroundColor: C.tint + "20",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  activeBadgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: C.tint,
  },
  providerActions: {
    flexDirection: "row",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 10,
  },
  providerActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: C.background,
  },
  activateBtn: {
    backgroundColor: C.tint + "15",
  },
  providerActionText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: C.textSecondary,
  },
  testResultText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    paddingTop: 4,
  },
  addProviderBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.tint + "40",
    borderStyle: "dashed",
  },
  addProviderText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.tint,
  },
  addProviderCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  addProviderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  addProviderTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: C.text,
  },
  providerForm: { gap: 14 },
  modalOverlay: {
    flex: 1,
    backgroundColor: C.overlay,
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: C.backgroundSecondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  modalTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: C.text,
  },
  modalBody: {
    padding: 20,
    gap: 16,
  },
  modalUserName: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: C.text,
  },
  modalUserEmail: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: C.textSecondary,
    marginTop: -8,
  },
  modalField: { gap: 6 },
  modalFieldLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: C.textSecondary,
  },
  modalInput: {
    backgroundColor: C.inputBackground,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.text,
    fontFamily: "Inter_500Medium",
    fontSize: 15,
  },
  roleRow: {
    flexDirection: "row",
    gap: 8,
  },
  roleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.card,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  roleBtnActive: {
    borderColor: C.tint,
    backgroundColor: C.tint + "15",
  },
  roleBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: C.textSecondary,
  },
  roleBtnTextActive: {
    color: C.tint,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  actionBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  modalSaveBtn: {
    backgroundColor: C.tint,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 4,
  },
  modalSaveBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    color: "#FFF",
  },
  genSectionTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: C.text,
  },
  genCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    gap: 14,
  },
  genToggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  genToggleLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
  genToggle: {
    width: 50,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.border,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  genToggleActive: {
    backgroundColor: C.tint,
  },
  genToggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FFF",
  },
  genToggleThumbActive: {
    alignSelf: "flex-end",
  },
});
