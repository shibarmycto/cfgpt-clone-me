import React, { useState, useCallback, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  Pressable,
  Platform,
  Alert,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetch } from "expo/fetch";
import { useAuth } from "@/contexts/AuthContext";
import {
  Conversation,
  getConversations,
  saveConversation,
  deleteConversation,
  generateId,
} from "@/lib/storage-helpers";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";

const C = Colors.light;

const PERSONALITY_STORAGE_KEY = "cfgpt_selected_personality";
const CHAT_MODE_STORAGE_KEY = "cfgpt_chat_mode";
const SELECTED_PROVIDER_STORAGE_KEY = "cfgpt_selected_provider";
const NORMAL_ACCENT = "#6366F1";

type ChatMode = "personality" | "normal";

interface Provider {
  id: string;
  name: string;
  type: string;
  available: boolean;
  model: string;
}

type PersonalityId = "urban" | "trader" | "eliza";

const MASCOT_IMAGES: Record<PersonalityId, any> = {
  urban: require("@/assets/images/cf_urban.png"),
  trader: require("@/assets/images/cf_trader.png"),
  eliza: require("@/assets/images/cf_eliza.png"),
};

const PERSONALITIES: Record<PersonalityId, { name: string; tagline: string; description: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  urban: { name: "CF Urban", tagline: "your crypto companion", description: "Crypto, football, gossip & vibes", color: "#00E676", icon: "flash" },
  trader: { name: "CF Trader", tagline: "your elite market analyst", description: "Markets, luxury & witty banter", color: "#FFD700", icon: "trending-up" },
  eliza: { name: "CF Eliza", tagline: "your spiritual bestie", description: "Positivity, soaps & spiritual vibes", color: "#FF69B4", icon: "heart" },
};

type AiTab = "chat" | "image" | "video" | "agent";

const AI_TABS: {
  key: AiTab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  credits: number;
  description: string;
}[] = [
  {
    key: "chat",
    label: "Chat",
    icon: "chatbubble",
    credits: 0,
    description: "Free AI chat",
  },
  {
    key: "image",
    label: "Image",
    icon: "image",
    credits: 1,
    description: "1 credit/gen",
  },
  {
    key: "video",
    label: "Video",
    icon: "videocam",
    credits: 2.5,
    description: "2.5 credits/gen",
  },
  {
    key: "agent",
    label: "Agent",
    icon: "code-slash",
    credits: 5,
    description: "5 credits/task",
  },
];

interface AttachedFile {
  name: string;
  uri: string;
  type: string;
  size: number;
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { user, isGuest, updateUser, guestChatsRemaining } = useAuth();
  const [activeTab, setActiveTab] = useState<AiTab>("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPersonality, setSelectedPersonality] = useState<PersonalityId>("urban");
  const [chatMode, setChatMode] = useState<ChatMode>("personality");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [loadingProviders, setLoadingProviders] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(PERSONALITY_STORAGE_KEY).then((val) => {
      if (val && (val === "urban" || val === "trader" || val === "eliza")) {
        setSelectedPersonality(val as PersonalityId);
      }
    });
    AsyncStorage.getItem(CHAT_MODE_STORAGE_KEY).then((val) => {
      if (val === "personality" || val === "normal") {
        setChatMode(val as ChatMode);
      }
    });
    AsyncStorage.getItem(SELECTED_PROVIDER_STORAGE_KEY).then((val) => {
      if (val) setSelectedProvider(val);
    });
  }, []);

  useEffect(() => {
    if (chatMode === "normal" && providers.length === 0) {
      setLoadingProviders(true);
      apiRequest("GET", "/api/chat/providers")
        .then((res) => res.json())
        .then((data) => {
          const available = (data.providers || []).filter((p: Provider) => p.available);
          setProviders(available);
          if (!selectedProvider && available.length > 0) {
            setSelectedProvider(available[0].id);
            AsyncStorage.setItem(SELECTED_PROVIDER_STORAGE_KEY, available[0].id);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingProviders(false));
    }
  }, [chatMode]);

  const handleChatModeChange = async (mode: ChatMode) => {
    setChatMode(mode);
    await AsyncStorage.setItem(CHAT_MODE_STORAGE_KEY, mode);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSelectProvider = async (providerId: string) => {
    setSelectedProvider(providerId);
    await AsyncStorage.setItem(SELECTED_PROVIDER_STORAGE_KEY, providerId);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSelectPersonality = async (pid: PersonalityId) => {
    setSelectedPersonality(pid);
    await AsyncStorage.setItem(PERSONALITY_STORAGE_KEY, pid);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleStartChatWithPersonality = async (pid: PersonalityId) => {
    await handleSelectPersonality(pid);
    if (!user) return;
    const conv: Conversation = {
      id: generateId(),
      title: `Chat with ${PERSONALITIES[pid].name}`,
      userId: user.id,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: "personality",
      personality: pid,
    };
    await saveConversation(conv);
    router.push({ pathname: "/chat/[id]", params: { id: conv.id } });
  };

  const handleNewNormalChat = async () => {
    if (!user) return;
    if (!selectedProvider) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const providerName = providers.find((p) => p.id === selectedProvider)?.name || "AI";
    const conv: Conversation = {
      id: generateId(),
      title: `Chat with ${providerName}`,
      userId: user.id,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: "normal",
      providerId: selectedProvider,
    };
    await saveConversation(conv);
    router.push({ pathname: "/chat/[id]", params: { id: conv.id, mode: "normal", providerId: selectedProvider } });
  };

  const [imagePrompt, setImagePrompt] = useState("");
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const [videoPrompt, setVideoPrompt] = useState("");
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoResult, setVideoResult] = useState<string | null>(null);
  const [videoImage, setVideoImage] = useState<string | null>(null);
  const [videoStoryboard, setVideoStoryboard] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentContext, setAgentContext] = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentOutput, setAgentOutput] = useState("");

  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    const convos = await getConversations(user.id);
    setConversations(convos);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadConversations();
    }, [loadConversations])
  );

  const canGenerate = (credits: number): boolean => {
    if (!user) return false;
    if (credits === 0) return true;

    const freeRemaining = Math.max(0, user.freeTrialMessages - user.usedMessages);
    if (freeRemaining > 0) return true;
    return user.credits >= credits;
  };

  const deductCredits = async (credits: number) => {
    if (!user) return;
    if (credits === 0) return;

    const freeRemaining = Math.max(0, user.freeTrialMessages - user.usedMessages);
    if (freeRemaining > 0) {
      await updateUser({ ...user, usedMessages: user.usedMessages + 1 });
    } else {
      await updateUser({ ...user, credits: Math.max(0, user.credits - credits) });
    }
  };

  const getRemainingInfo = (): string => {
    if (isGuest) {
      return `${guestChatsRemaining} free chats left`;
    }
    if (!user) return "";
    const freeRemaining = Math.max(0, user.freeTrialMessages - user.usedMessages);
    const freePhotos = Math.max(0, (user.freePhotoGenerations ?? 0) - (user.usedPhotoGenerations ?? 0));
    const freeVideos = Math.max(0, (user.freeVideoGenerations ?? 0) - (user.usedVideoGenerations ?? 0));
    const parts: string[] = [];
    if (freeRemaining > 0) parts.push(`${freeRemaining} free chats`);
    if (freePhotos > 0) parts.push(`${freePhotos} free photo`);
    if (freeVideos > 0) parts.push(`${freeVideos} free video`);
    if (parts.length > 0) return parts.join(", ") + " left";
    return `${user.credits} credits available`;
  };

  const requireSignUp = () => {
    if (Platform.OS === "web") {
      router.push("/auth");
    } else {
      Alert.alert(
        "Sign Up Required",
        "Create a free account to unlock image generation, video creation, voice cloning, and more!",
        [
          { text: "Not Now", style: "cancel" },
          { text: "Sign Up", onPress: () => router.push("/auth") },
        ]
      );
    }
  };

  const handleAttachFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["*/*"],
        multiple: true,
      });

      if (!result.canceled && result.assets) {
        const newFiles: AttachedFile[] = result.assets.map((asset) => ({
          name: asset.name,
          uri: asset.uri,
          type: asset.mimeType || "application/octet-stream",
          size: asset.size || 0,
        }));
        setAttachedFiles((prev) => [...prev, ...newFiles]);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {}
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const handleNewChat = async () => {
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const conv: Conversation = {
      id: generateId(),
      title: "New Chat",
      userId: user.id,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: "personality",
      personality: selectedPersonality,
    };
    await saveConversation(conv);
    router.push({ pathname: "/chat/[id]", params: { id: conv.id } });
  };

  const handleDelete = (convId: string) => {
    if (Platform.OS === "web") {
      deleteConversation(convId).then(loadConversations);
    } else {
      Alert.alert("Delete Chat", "Are you sure?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteConversation(convId);
            loadConversations();
          },
        },
      ]);
    }
  };

  const handleGenerateImage = async () => {
    if (!imagePrompt.trim()) return;
    const freePhotosRemaining = user ? Math.max(0, (user.freePhotoGenerations ?? 0) - (user.usedPhotoGenerations ?? 0)) : 0;
    const usingFreePhoto = freePhotosRemaining > 0;

    if (!usingFreePhoto && !canGenerate(1)) {
      const msg = "You don't have enough credits for image generation.";
      if (Platform.OS === "web") alert(msg);
      else Alert.alert("Insufficient Credits", msg);
      return;
    }

    setGeneratingImage(true);
    setGeneratedImage(null);
    setImageError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      let fullPrompt = imagePrompt;
      if (attachedFiles.length > 0) {
        fullPrompt += `\n\n[Attached files: ${attachedFiles.map((f) => f.name).join(", ")}]`;
      }

      const res = await apiRequest("POST", "/api/ai/generate-image", {
        prompt: fullPrompt,
        size: "1024x1024",
      });
      const data = await res.json();
      if (data.error) {
        setImageError(data.error);
      } else if (data.image) {
        setGeneratedImage(`data:image/png;base64,${data.image}`);
        if (usingFreePhoto && user) {
          await updateUser({ ...user, usedPhotoGenerations: (user.usedPhotoGenerations ?? 0) + 1 });
        } else {
          await deductCredits(1);
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (data.url) {
        setGeneratedImage(data.url);
        if (usingFreePhoto && user) {
          await updateUser({ ...user, usedPhotoGenerations: (user.usedPhotoGenerations ?? 0) + 1 });
        } else {
          await deductCredits(1);
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setImageError("No image was generated. Check your API configuration in Admin settings.");
      }
    } catch (err: any) {
      const errorMsg = err.message || "Failed to generate image";
      setImageError(errorMsg);
    } finally {
      setGeneratingImage(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!videoPrompt.trim()) return;
    const freeVideosRemaining = user ? Math.max(0, (user.freeVideoGenerations ?? 0) - (user.usedVideoGenerations ?? 0)) : 0;
    const usingFreeVideo = freeVideosRemaining > 0;

    if (!usingFreeVideo && !canGenerate(2.5)) {
      const msg = "You need at least 2.5 credits for video generation.";
      if (Platform.OS === "web") alert(msg);
      else Alert.alert("Insufficient Credits", msg);
      return;
    }

    setGeneratingVideo(true);
    setVideoResult(null);
    setVideoError(null);
    setVideoImage(null);
    setVideoStoryboard(null);
    setVideoUrl(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      let fullPrompt = videoPrompt;
      if (attachedFiles.length > 0) {
        fullPrompt += `\n\n[Attached files: ${attachedFiles.map((f) => f.name).join(", ")}]`;
      }

      const res = await apiRequest("POST", "/api/ai/generate-video", {
        prompt: fullPrompt,
      });
      const data = await res.json();
      if (data.error) {
        setVideoError(data.error);
      } else {
        if (data.videoUrl) {
          setVideoUrl(data.videoUrl);
          setVideoResult("Video generated successfully!");
        } else if (data.b64) {
          setVideoImage(`data:image/png;base64,${data.b64}`);
          setVideoResult("Video storyboard and key frame generated.");
        } else if (data.url) {
          setVideoImage(data.url);
          setVideoResult("Video storyboard generated.");
        }
        if (data.storyboard) {
          setVideoStoryboard(data.storyboard);
        }
        if (usingFreeVideo && user) {
          await updateUser({ ...user, usedVideoGenerations: (user.usedVideoGenerations ?? 0) + 1 });
        } else {
          await deductCredits(2.5);
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err: any) {
      const errorMsg = err.message || "Failed to generate video";
      setVideoError(errorMsg);
    } finally {
      setGeneratingVideo(false);
    }
  };

  const handleRunAgent = async () => {
    if (!agentPrompt.trim()) return;
    if (!canGenerate(5)) {
      const msg = "Agent Kimi requires 5 credits per task.";
      if (Platform.OS === "web") alert(msg);
      else Alert.alert("Insufficient Credits", msg);
      return;
    }

    setAgentRunning(true);
    setAgentOutput("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      const baseUrl = getApiUrl();
      const url = new URL("/api/ai/agent", baseUrl).toString();

      let contextStr = agentContext;
      if (attachedFiles.length > 0) {
        contextStr += `\nAttached files: ${attachedFiles.map((f) => `${f.name} (${f.type})`).join(", ")}`;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: agentPrompt,
          context: contextStr,
        }),
      });

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader available");

      const decoder = new TextDecoder();
      let fullOutput = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullOutput += parsed.content;
                setAgentOutput(fullOutput);
              }
            } catch {}
          }
        }
      }

      await deductCredits(5);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setAgentOutput(`Error: ${err.message || "Agent failed"}`);
    } finally {
      setAgentRunning(false);
    }
  };

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  const filteredConversations = conversations.filter((c) => {
    if (chatMode === "normal") return c.mode === "normal";
    return c.mode === "personality" || !c.mode;
  });

  const renderChatItem = ({ item }: { item: Conversation }) => {
    const lastMsg = item.messages[item.messages.length - 1];
    const preview = lastMsg
      ? lastMsg.content.slice(0, 60) +
        (lastMsg.content.length > 60 ? "..." : "")
      : "No messages yet";
    const time = new Date(item.updatedAt);
    const timeStr = time.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const isNormal = item.mode === "normal";
    const accentColor = isNormal ? NORMAL_ACCENT : C.tint;

    return (
      <Pressable
        onPress={() => {
          if (isNormal) {
            router.push({ pathname: "/chat/[id]", params: { id: item.id, mode: "normal", providerId: item.providerId || "" } });
          } else {
            router.push({ pathname: "/chat/[id]", params: { id: item.id } });
          }
        }}
        onLongPress={() => handleDelete(item.id)}
        style={({ pressed }) => [
          styles.chatItem,
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <View style={[styles.chatAvatar, { backgroundColor: accentColor + "15" }]}>
          <Ionicons name={isNormal ? "globe" : "chatbubble"} size={20} color={accentColor} />
        </View>
        <View style={styles.chatContent}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.chatTime}>{timeStr}</Text>
          </View>
          <Text style={styles.chatPreview} numberOfLines={1}>
            {preview}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={C.textTertiary} />
      </Pressable>
    );
  };

  const renderAttachments = () => {
    if (attachedFiles.length === 0) return null;
    return (
      <View style={styles.attachList}>
        {attachedFiles.map((file, idx) => (
          <View key={idx} style={styles.attachItem}>
            <Ionicons name="document-attach" size={14} color={C.accent} />
            <Text style={styles.attachName} numberOfLines={1}>
              {file.name}
            </Text>
            <Text style={styles.attachSize}>{formatFileSize(file.size)}</Text>
            <Pressable onPress={() => removeAttachedFile(idx)}>
              <Ionicons name="close-circle" size={16} color={C.textTertiary} />
            </Pressable>
          </View>
        ))}
      </View>
    );
  };

  const attachButton = (
    <Pressable
      onPress={handleAttachFile}
      style={({ pressed }) => [
        styles.attachBtn,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name="attach" size={18} color={C.accent} />
      <Text style={styles.attachBtnText}>Attach Files</Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.headerBar, { paddingTop: topInset + 8 }]}>
        <Text style={styles.headerTitle}>AI Studio</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={styles.creditsBadge}>
            <Ionicons name="flash" size={12} color={C.warning} />
            <Text style={styles.creditsText}>{getRemainingInfo()}</Text>
          </View>
          {isGuest && (
            <Pressable
              onPress={() => router.push("/auth")}
              style={({ pressed }) => [
                styles.signUpHeaderBtn,
                { opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Ionicons name="person-add" size={14} color="#FFF" />
              <Text style={styles.signUpHeaderText}>Sign Up</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.aiTabRow}>
        {AI_TABS.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (isGuest && tab.key !== "chat") {
                requireSignUp();
                return;
              }
              setActiveTab(tab.key);
              setAttachedFiles([]);
            }}
            style={[
              styles.aiTabBtn,
              activeTab === tab.key && styles.aiTabBtnActive,
            ]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons
                name={isGuest && tab.key !== "chat" ? "lock-closed" : tab.icon}
                size={isGuest && tab.key !== "chat" ? 14 : 18}
                color={activeTab === tab.key ? C.tint : (isGuest && tab.key !== "chat" ? C.textTertiary : C.textSecondary)}
              />
            </View>
            <Text
              style={[
                styles.aiTabLabel,
                activeTab === tab.key && styles.aiTabLabelActive,
                isGuest && tab.key !== "chat" && { color: C.textTertiary },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeTab === "chat" ? (
        <>
          <View style={styles.chatModeToggle}>
            <Pressable
              onPress={() => handleChatModeChange("personality")}
              style={[
                styles.chatModePill,
                chatMode === "personality" && styles.chatModePillActive,
              ]}
            >
              <Ionicons name="people" size={14} color={chatMode === "personality" ? "#FFF" : C.textSecondary} />
              <Text style={[styles.chatModePillText, chatMode === "personality" && styles.chatModePillTextActive]}>Personalities</Text>
            </Pressable>
            <Pressable
              onPress={() => handleChatModeChange("normal")}
              style={[
                styles.chatModePill,
                chatMode === "normal" && styles.chatModePillActiveNormal,
              ]}
            >
              <Ionicons name="globe" size={14} color={chatMode === "normal" ? "#FFF" : C.textSecondary} />
              <Text style={[styles.chatModePillText, chatMode === "normal" && styles.chatModePillTextActive]}>Normal Chat</Text>
            </Pressable>
          </View>

          {chatMode === "personality" ? (
            <FlatList
              data={filteredConversations}
              keyExtractor={(item) => item.id}
              renderItem={renderChatItem}
              contentContainerStyle={[
                styles.listContent,
                filteredConversations.length === 0 && styles.emptyContent,
              ]}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                <View>
                  <View style={styles.mascotShowcase}>
                    <Text style={styles.mascotShowcaseTitle}>Choose Your AI Companion</Text>
                    <Text style={styles.mascotShowcaseSub}>Each character has a unique personality</Text>
                    <View style={styles.mascotCardsRow}>
                      {(["urban", "trader", "eliza"] as PersonalityId[]).map((pid) => {
                        const p = PERSONALITIES[pid];
                        const isSelected = selectedPersonality === pid;
                        return (
                          <Pressable
                            key={pid}
                            onPress={() => handleStartChatWithPersonality(pid)}
                            style={({ pressed }) => [
                              styles.mascotCard,
                              { borderColor: isSelected ? p.color : C.border, opacity: pressed ? 0.85 : 1 },
                              isSelected && { backgroundColor: p.color + "12" },
                            ]}
                          >
                            <View style={[styles.mascotImgWrap, { borderColor: p.color + "80" }]}>
                              <Image source={MASCOT_IMAGES[pid]} style={styles.mascotImg} />
                            </View>
                            <Text style={[styles.mascotCardName, { color: p.color }]}>{p.name}</Text>
                            <Text style={styles.mascotCardDesc} numberOfLines={2}>{p.description}</Text>
                            <View style={[styles.mascotCardBtn, { backgroundColor: p.color + "20" }]}>
                              <Ionicons name="chatbubble" size={10} color={p.color} />
                              <Text style={[styles.mascotCardBtnText, { color: p.color }]}>Chat</Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <Pressable
                    onPress={handleNewChat}
                    style={({ pressed }) => [
                      styles.newChatCard,
                      { opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <View style={styles.newChatIcon}>
                      <Ionicons name="add" size={24} color={C.tint} />
                    </View>
                    <View>
                      <Text style={styles.newChatTitle}>New Chat</Text>
                      <Text style={styles.newChatSub}>
                        Start a conversation with AI
                      </Text>
                    </View>
                  </Pressable>

                  {filteredConversations.length > 0 && (
                    <Text style={styles.recentChatsLabel}>Recent Conversations</Text>
                  )}
                </View>
              }
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Image source={MASCOT_IMAGES[selectedPersonality]} style={styles.emptyMascotImg} />
                  <Text style={[styles.emptyTitle, { color: PERSONALITIES[selectedPersonality].color }]}>
                    {PERSONALITIES[selectedPersonality].name}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    {PERSONALITIES[selectedPersonality].tagline}
                  </Text>
                  <Text style={styles.emptyHint}>
                    Tap a character above to start chatting
                  </Text>
                </View>
              }
            />
          ) : (
            <FlatList
              data={filteredConversations}
              keyExtractor={(item) => item.id}
              renderItem={renderChatItem}
              contentContainerStyle={[
                styles.listContent,
                filteredConversations.length === 0 && styles.emptyContent,
              ]}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                <View>
                  {loadingProviders ? (
                    <View style={styles.providerLoading}>
                      <ActivityIndicator size="small" color={NORMAL_ACCENT} />
                    </View>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.providerRow} contentContainerStyle={styles.providerRowContent}>
                      {providers.map((p) => (
                        <Pressable
                          key={p.id}
                          onPress={() => handleSelectProvider(p.id)}
                          style={[
                            styles.providerChip,
                            selectedProvider === p.id && styles.providerChipActive,
                          ]}
                        >
                          <Text style={[styles.providerChipText, selectedProvider === p.id && styles.providerChipTextActive]}>{p.name}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}

                  <Pressable
                    onPress={handleNewNormalChat}
                    style={({ pressed }) => [
                      styles.normalNewChatCard,
                      { opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <View style={styles.normalNewChatIcon}>
                      <Ionicons name="add" size={24} color={NORMAL_ACCENT} />
                    </View>
                    <View>
                      <Text style={styles.normalNewChatTitle}>New Chat</Text>
                      <Text style={styles.normalNewChatSub}>
                        {providers.find((p) => p.id === selectedProvider)?.name || "Select a provider"}
                      </Text>
                    </View>
                  </Pressable>

                  {filteredConversations.length > 0 && (
                    <Text style={styles.recentChatsLabel}>Recent Conversations</Text>
                  )}
                </View>
              }
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="globe-outline" size={48} color={NORMAL_ACCENT} />
                  <Text style={[styles.emptyTitle, { color: NORMAL_ACCENT }]}>
                    Normal Chat
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    Chat with any AI provider
                  </Text>
                  <Text style={styles.emptyHint}>
                    Select a provider and tap New Chat to begin
                  </Text>
                </View>
              }
            />
          )}
        </>
      ) : activeTab === "image" ? (
        <ScrollView
          contentContainerStyle={styles.genContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.genCard}>
            <View style={styles.genHeader}>
              <View style={styles.genIconWrap}>
                <Ionicons name="image" size={24} color="#FF6B9D" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.genTitle}>Image Generation</Text>
                <Text style={styles.genSub}>
                  Create stunning images from text descriptions
                </Text>
              </View>
            </View>

            <TextInput
              style={[styles.genInput, styles.genInputLarge]}
              value={imagePrompt}
              onChangeText={setImagePrompt}
              placeholder="Describe the image you want to create..."
              placeholderTextColor={C.placeholder}
              multiline
              numberOfLines={3}
            />

            {attachButton}
            {renderAttachments()}

            <Pressable
              onPress={handleGenerateImage}
              disabled={generatingImage || !imagePrompt.trim()}
              style={({ pressed }) => [
                styles.genBtn,
                { backgroundColor: "#FF6B9D" },
                {
                  opacity:
                    pressed || generatingImage || !imagePrompt.trim()
                      ? 0.6
                      : 1,
                },
              ]}
            >
              {generatingImage ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Ionicons name="sparkles" size={18} color="#FFF" />
              )}
              <Text style={styles.genBtnText}>
                {generatingImage ? "Generating..." : "Generate Image"}
              </Text>
              <View style={styles.creditChip}>
                <Text style={styles.creditChipText}>1 credit</Text>
              </View>
            </Pressable>

            {imageError && (
              <View style={styles.errorCard}>
                <Ionicons
                  name="alert-circle"
                  size={16}
                  color={C.danger}
                />
                <Text style={styles.errorText}>{imageError}</Text>
              </View>
            )}

            {generatedImage && (
              <View style={styles.imageResult}>
                <Image
                  source={{ uri: generatedImage }}
                  style={styles.generatedImg}
                  resizeMode="contain"
                />
              </View>
            )}
          </View>
        </ScrollView>
      ) : activeTab === "video" ? (
        <ScrollView
          contentContainerStyle={styles.genContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.genCard}>
            <View style={styles.genHeader}>
              <View
                style={[styles.genIconWrap, { backgroundColor: C.purple + "20" }]}
              >
                <Ionicons name="videocam" size={24} color={C.purple} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.genTitle}>Video Generation</Text>
                <Text style={styles.genSub}>
                  Create social media videos from descriptions
                </Text>
              </View>
            </View>

            <TextInput
              style={[styles.genInput, styles.genInputLarge]}
              value={videoPrompt}
              onChangeText={setVideoPrompt}
              placeholder="Describe the video you want to create..."
              placeholderTextColor={C.placeholder}
              multiline
              numberOfLines={3}
            />

            {attachButton}
            {renderAttachments()}

            <Pressable
              onPress={handleGenerateVideo}
              disabled={generatingVideo || !videoPrompt.trim()}
              style={({ pressed }) => [
                styles.genBtn,
                { backgroundColor: C.purple },
                {
                  opacity:
                    pressed || generatingVideo || !videoPrompt.trim()
                      ? 0.6
                      : 1,
                },
              ]}
            >
              {generatingVideo ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Ionicons name="sparkles" size={18} color="#FFF" />
              )}
              <Text style={styles.genBtnText}>
                {generatingVideo ? "Generating video (may take a minute)..." : "Generate Video"}
              </Text>
              <View style={styles.creditChip}>
                <Text style={styles.creditChipText}>1 credit</Text>
              </View>
            </Pressable>

            {videoError && (
              <View style={styles.errorCard}>
                <Ionicons
                  name="alert-circle"
                  size={16}
                  color={C.danger}
                />
                <Text style={styles.errorText}>{videoError}</Text>
              </View>
            )}

            {videoResult && (
              <View style={styles.successCard}>
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color={C.success}
                />
                <Text style={styles.successText}>{videoResult}</Text>
              </View>
            )}

            {videoUrl && Platform.OS === "web" && (
              <View style={styles.imageResult}>
                <video
                  src={videoUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  style={{
                    width: "100%",
                    maxHeight: 300,
                    borderRadius: 12,
                    backgroundColor: "#000",
                  } as any}
                />
                <Pressable
                  onPress={() => {
                    if (videoUrl) {
                      const link = document.createElement("a");
                      link.href = videoUrl;
                      link.download = `cfgpt-video-${Date.now()}.mp4`;
                      link.target = "_blank";
                      link.rel = "noopener noreferrer";
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }
                  }}
                  style={{ flexDirection: "row" as const, alignItems: "center" as const, gap: 6, backgroundColor: C.tint, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, marginTop: 10, alignSelf: "center" as const }}
                >
                  <Ionicons name="download-outline" size={18} color="#FFF" />
                  <Text style={{ color: "#FFF", fontWeight: "600" as const, fontSize: 13 }}>Download Video</Text>
                </Pressable>
              </View>
            )}

            {videoUrl && Platform.OS !== "web" && (
              <View style={[styles.successCard, { flexDirection: "column", gap: 8 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="videocam" size={16} color={C.success} />
                  <Text style={styles.successText}>Video ready! Hold the link to save.</Text>
                </View>
                <Pressable
                  onPress={() => {
                    if (videoUrl) {
                      const { Linking } = require("react-native");
                      Linking.openURL(videoUrl);
                    }
                  }}
                  style={{ backgroundColor: C.purple, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16, alignSelf: "flex-start" as const }}
                >
                  <Text style={{ color: "#FFF", fontWeight: "600" as const, fontSize: 13 }}>Open Video</Text>
                </Pressable>
              </View>
            )}

            {videoImage && !videoUrl && (
              <View style={styles.imageResult}>
                <Image
                  source={{ uri: videoImage }}
                  style={styles.generatedImg}
                  resizeMode="contain"
                />
              </View>
            )}

            {videoStoryboard && (
              <View style={[styles.infoCard, { flexDirection: "column", alignItems: "flex-start", gap: 8 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="film-outline" size={16} color={C.purple} />
                  <Text style={[styles.infoText, { color: C.purple, fontWeight: "600" as const }]}>Storyboard</Text>
                </View>
                <Text style={[styles.infoText, { lineHeight: 20 }]}>{videoStoryboard}</Text>
              </View>
            )}

            <View style={styles.infoCard}>
              <Ionicons
                name="information-circle"
                size={16}
                color={C.accent}
              />
              <Text style={styles.infoText}>
                Video generation powered by CFGPT engine.
                Settings can be changed in Admin.
              </Text>
            </View>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.genContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.genCard}>
            <View style={styles.genHeader}>
              <View
                style={[
                  styles.genIconWrap,
                  { backgroundColor: C.tint + "20" },
                ]}
              >
                <Ionicons name="code-slash" size={24} color={C.tint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.genTitle}>Agent Kimi</Text>
                <Text style={styles.genSub}>
                  AI agent for code generation and file editing
                </Text>
              </View>
              <View style={styles.agentBadge}>
                <Text style={styles.agentBadgeText}>5 credits</Text>
              </View>
            </View>

            <TextInput
              style={[styles.genInput, styles.genInputLarge]}
              value={agentPrompt}
              onChangeText={setAgentPrompt}
              placeholder="What should Agent Kimi do? e.g. 'Create a landing page with...'"
              placeholderTextColor={C.placeholder}
              multiline
              numberOfLines={4}
            />

            <TextInput
              style={styles.genInput}
              value={agentContext}
              onChangeText={setAgentContext}
              placeholder="Additional context (optional)"
              placeholderTextColor={C.placeholder}
            />

            {attachButton}
            {renderAttachments()}

            <Pressable
              onPress={handleRunAgent}
              disabled={agentRunning || !agentPrompt.trim()}
              style={({ pressed }) => [
                styles.genBtn,
                { backgroundColor: C.tint },
                {
                  opacity:
                    pressed || agentRunning || !agentPrompt.trim()
                      ? 0.6
                      : 1,
                },
              ]}
            >
              {agentRunning ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Ionicons name="flash" size={18} color="#FFF" />
              )}
              <Text style={styles.genBtnText}>
                {agentRunning ? "Agent working..." : "Run Agent Kimi"}
              </Text>
            </Pressable>

            {agentOutput ? (
              <View style={styles.agentOutputCard}>
                <View style={styles.agentOutputHeader}>
                  <Ionicons name="terminal" size={16} color={C.tint} />
                  <Text style={styles.agentOutputTitle}>Agent Output</Text>
                </View>
                <ScrollView
                  style={styles.agentOutputScroll}
                  nestedScrollEnabled
                >
                  <Text style={styles.agentOutputText} selectable>
                    {agentOutput}
                  </Text>
                </ScrollView>
              </View>
            ) : null}
          </View>
        </ScrollView>
      )}
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
  creditsBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.warning + "15",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  creditsText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: C.warning,
  },
  signUpHeaderBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    backgroundColor: C.tint,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  signUpHeaderText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: "#FFF",
  },
  aiTabRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  aiTabBtn: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: "transparent",
  },
  aiTabBtnActive: {
    borderColor: C.tint,
    backgroundColor: C.tint + "10",
  },
  aiTabLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: C.textSecondary,
  },
  aiTabLabelActive: {
    color: C.tint,
  },
  listContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 100 },
  emptyContent: { flex: 1, justifyContent: "center" },
  newChatCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: C.tint + "10",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.tint + "30",
  },
  newChatIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: C.tint + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  newChatTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: C.tint,
  },
  newChatSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  chatItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    marginVertical: 4,
    gap: 12,
  },
  chatAvatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: C.tint + "15",
    alignItems: "center",
    justifyContent: "center",
  },
  chatContent: { flex: 1, gap: 4 },
  chatHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  chatTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: C.text,
    flex: 1,
    marginRight: 8,
  },
  chatTime: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: C.textTertiary,
  },
  chatPreview: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: C.textSecondary,
  },
  mascotShowcase: {
    marginBottom: 12,
    gap: 8,
  },
  mascotShowcaseTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 17,
    color: C.text,
  },
  mascotShowcaseSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textSecondary,
    marginBottom: 4,
  },
  mascotCardsRow: {
    flexDirection: "row",
    gap: 8,
  },
  mascotCard: {
    flex: 1,
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderWidth: 1.5,
    gap: 6,
  },
  mascotImgWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    overflow: "hidden",
  },
  mascotImg: {
    width: "100%",
    height: "100%",
  },
  mascotCardName: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
  },
  mascotCardDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 14,
  },
  mascotCardBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    marginTop: 2,
  },
  mascotCardBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
  },
  recentChatsLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.textSecondary,
    marginTop: 8,
    marginBottom: 4,
  },
  emptyMascotImg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 4,
  },
  emptyState: { alignItems: "center", gap: 6, paddingBottom: 80 },
  emptyTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    marginTop: 4,
  },
  emptySubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: C.textSecondary,
  },
  emptyHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textTertiary,
    marginTop: 8,
  },
  genContent: { paddingHorizontal: 16, paddingBottom: 120, paddingTop: 4 },
  genCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    gap: 14,
  },
  genHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  genIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#FF6B9D20",
    alignItems: "center",
    justifyContent: "center",
  },
  genTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: C.text,
  },
  genSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  genInput: {
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
  genInputLarge: {
    minHeight: 80,
    textAlignVertical: "top" as const,
    paddingTop: 12,
  },
  genBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  genBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#FFF",
  },
  creditChip: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  creditChipText: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    color: "#FFF",
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: C.danger + "15",
    padding: 12,
    borderRadius: 10,
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.danger,
    flex: 1,
  },
  successCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.success + "15",
    padding: 12,
    borderRadius: 10,
  },
  successText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.success,
    flex: 1,
  },
  imageResult: {
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    gap: 8,
  },
  generatedImg: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
  },
  infoCard: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: C.accent + "10",
    padding: 12,
    borderRadius: 10,
  },
  infoText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: C.textSecondary,
    lineHeight: 16,
  },
  agentBadge: {
    backgroundColor: C.tint + "20",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  agentBadgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: C.tint,
  },
  agentOutputCard: {
    backgroundColor: C.background,
    borderRadius: 12,
    overflow: "hidden",
  },
  agentOutputHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    backgroundColor: C.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  agentOutputTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: C.tint,
  },
  agentOutputScroll: {
    maxHeight: 300,
    padding: 12,
  },
  agentOutputText: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    color: C.text,
    lineHeight: 20,
  },
  attachBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: C.accent + "15",
    alignSelf: "flex-start",
  },
  attachBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: C.accent,
  },
  attachList: {
    gap: 6,
  },
  attachItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.background,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  attachName: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.text,
  },
  attachSize: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: C.textTertiary,
  },
  chatModeToggle: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: C.card,
    marginHorizontal: 12,
    borderRadius: 12,
    padding: 4,
  },
  chatModePill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
  },
  chatModePillActive: {
    backgroundColor: C.tint,
  },
  chatModePillActiveNormal: {
    backgroundColor: NORMAL_ACCENT,
  },
  chatModePillText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: C.textSecondary,
  },
  chatModePillTextActive: {
    color: "#FFF",
  },
  providerRow: {
    marginBottom: 12,
  },
  providerRowContent: {
    gap: 8,
  },
  providerChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  providerChipActive: {
    backgroundColor: NORMAL_ACCENT + "20",
    borderColor: NORMAL_ACCENT,
  },
  providerChipText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: C.textSecondary,
  },
  providerChipTextActive: {
    color: NORMAL_ACCENT,
  },
  providerLoading: {
    paddingVertical: 16,
    alignItems: "center",
  },
  normalNewChatCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: NORMAL_ACCENT + "10",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: NORMAL_ACCENT + "30",
  },
  normalNewChatIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: NORMAL_ACCENT + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  normalNewChatTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: NORMAL_ACCENT,
  },
  normalNewChatSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
});
