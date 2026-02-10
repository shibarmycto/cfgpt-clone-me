import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TextInput,
  Pressable,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { fetch } from "expo/fetch";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/contexts/AuthContext";
import {
  ChatMessage,
  Conversation,
  MatrixSettings,
  getConversations,
  saveConversation,
  saveUser,
  generateId,
  getMatrixSettings,
  saveMatrixSettings,
} from "@/lib/storage-helpers";
import { getApiUrl, apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";
import MatrixRain from "@/components/MatrixRain";

const MASCOT_IMAGES: Record<string, any> = {
  urban: require("@/assets/images/cf_urban.png"),
  trader: require("@/assets/images/cf_trader.png"),
  eliza: require("@/assets/images/cf_eliza.png"),
};

type PersonalityId = "urban" | "trader" | "eliza";

const PERSONALITIES: Record<PersonalityId, { name: string; tagline: string; description: string; color: string; icon: string }> = {
  urban: { name: "CF Urban", tagline: "your crypto companion", description: "Streetwise, laid-back, loves crypto & football banter", color: "#00E676", icon: "flash" },
  trader: { name: "CF Trader", tagline: "your elite market analyst", description: "Posh London day trader, witty comedian, luxury lifestyle", color: "#FFD700", icon: "trending-up" },
  eliza: { name: "CF Eliza", tagline: "your spiritual bestie", description: "Positivity, affirmations, spiritual vibes & soap gossip", color: "#FF69B4", icon: "heart" },
};

const SUGGESTIONS: Record<PersonalityId, string[]> = {
  urban: ["What's happening in crypto?", "Who's winning the league?", "What's the latest gossip?"],
  trader: ["How are the markets looking?", "Best trade setups today?", "Tell me about CF Blockchain"],
  eliza: ["I need some positivity today", "What's happening on EastEnders?", "What do my angel numbers mean?"],
};

const NORMAL_SUGGESTIONS = [
  "Help me write an email",
  "Explain quantum computing",
  "Write a Python script",
  "Summarize this topic for me",
];

const PLACEHOLDERS: Record<PersonalityId, string> = {
  urban: "say something to CF...",
  trader: "speak to the Trader...",
  eliza: "talk to Eliza...",
};

const C = Colors.light;
const NORMAL_ACCENT = "#6366F1";

const MATRIX_COST = 1;
const MATRIX_DURATION_DAYS = 7;
const PERSONALITY_STORAGE_KEY = "cfgpt_selected_personality";
const DEVICE_ID_KEY = "@cfgpt_device_id";

async function getDeviceId(): Promise<string> {
  try {
    let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = `dev-${Date.now()}-${Math.random().toString(36).substr(2, 12)}`;
      await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
  } catch {
    return `dev-${Date.now()}`;
  }
}

let msgCounter = 0;
function uniqueId(): string {
  msgCounter++;
  return `msg-${Date.now()}-${msgCounter}-${Math.random().toString(36).substr(2, 9)}`;
}

export default function ChatDetailScreen() {
  const { id, mode, providerId, providerName: routeProviderName } = useLocalSearchParams<{ id: string; mode?: string; providerId?: string; providerName?: string }>();
  const insets = useSafeAreaInsets();
  const { user, isGuest, updateUser, guestChatsRemaining, incrementGuestChats } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [convTitle, setConvTitle] = useState("Chat");
  const inputRef = useRef<TextInput>(null);
  const initializedRef = useRef(false);

  const [chatMode, setChatMode] = useState<"personality" | "normal">(
    mode === "normal" ? "normal" : "personality"
  );
  const [activeProviderId, setActiveProviderId] = useState<string | undefined>(providerId);
  const [providerDisplayName, setProviderDisplayName] = useState<string>(routeProviderName || "AI Assistant");

  const [personality, setPersonality] = useState<PersonalityId>("urban");
  const [showPersonalityPicker, setShowPersonalityPicker] = useState(false);

  const [matrixSettings, setMatrixSettings] = useState<MatrixSettings>({
    userId: "",
    enabled: false,
    color: "green",
    expiresAt: null,
  });
  const [showMatrixModal, setShowMatrixModal] = useState(false);

  useEffect(() => {
    if (chatMode === "normal" && !routeProviderName) {
      (async () => {
        try {
          const res = await apiRequest("GET", "api/chat/providers");
          const data = await res.json();
          if (data.providers && Array.isArray(data.providers)) {
            const match = data.providers.find((p: any) => p.id === activeProviderId);
            if (match) {
              setProviderDisplayName(match.name || match.id);
            }
          }
        } catch {}
      })();
    }
  }, [chatMode, activeProviderId]);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(PERSONALITY_STORAGE_KEY);
        if (saved && (saved === "urban" || saved === "trader" || saved === "eliza")) {
          setPersonality(saved as PersonalityId);
        }
      } catch {}
    })();
  }, []);

  const handlePersonalityChange = async (newPersonality: PersonalityId) => {
    setPersonality(newPersonality);
    await AsyncStorage.setItem(PERSONALITY_STORAGE_KEY, newPersonality);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  useEffect(() => {
    if (!user || !id || initializedRef.current) return;
    (async () => {
      const convos = await getConversations(user.id);
      const conv = convos.find((c) => c.id === id);
      if (conv) {
        setMessages(conv.messages);
        setConvTitle(conv.title);
        if (!mode && conv.mode) {
          setChatMode(conv.mode);
        }
        if (!providerId && conv.providerId) {
          setActiveProviderId(conv.providerId);
        }
        if (conv.personality && (conv.personality === "urban" || conv.personality === "trader" || conv.personality === "eliza")) {
          setPersonality(conv.personality as PersonalityId);
        }
        initializedRef.current = true;
      }
      const ms = await getMatrixSettings(user.id);
      if (ms.expiresAt && new Date(ms.expiresAt) < new Date()) {
        ms.enabled = false;
        ms.expiresAt = null;
        await saveMatrixSettings(ms);
      }
      setMatrixSettings(ms);
    })();
  }, [user, id]);

  const isMatrixActive = matrixSettings.enabled && matrixSettings.expiresAt && new Date(matrixSettings.expiresAt) > new Date();

  const handleActivateMatrix = async (color: "green" | "red" | "blue") => {
    if (!user) return;
    if (isGuest) {
      Alert.alert("Sign In Required", "Sign in to unlock the Matrix background.");
      return;
    }
    const totalAllowed = user.freeTrialMessages + user.credits;
    if (user.usedMessages + MATRIX_COST > totalAllowed && user.credits < MATRIX_COST) {
      Alert.alert("Not Enough Credits", `The Matrix background costs ${MATRIX_COST} credit for ${MATRIX_DURATION_DAYS} days. You don't have enough credits.`);
      return;
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + MATRIX_DURATION_DAYS);

    const newSettings: MatrixSettings = {
      userId: user.id,
      enabled: true,
      color,
      expiresAt: expiresAt.toISOString(),
    };
    await saveMatrixSettings(newSettings);
    setMatrixSettings(newSettings);

    const updatedUser = { ...user, credits: Math.max(0, user.credits - MATRIX_COST) };
    await updateUser(updatedUser);

    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowMatrixModal(false);
  };

  const handleChangeColor = async (color: "green" | "red" | "blue") => {
    if (!user) return;
    const newSettings = { ...matrixSettings, color };
    await saveMatrixSettings(newSettings);
    setMatrixSettings(newSettings);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleToggleMatrix = async () => {
    if (!user) return;
    if (!matrixSettings.expiresAt || new Date(matrixSettings.expiresAt) < new Date()) {
      setShowMatrixModal(true);
      return;
    }
    const newSettings = { ...matrixSettings, enabled: !matrixSettings.enabled };
    await saveMatrixSettings(newSettings);
    setMatrixSettings(newSettings);
  };

  const saveMessages = async (msgs: ChatMessage[], title?: string) => {
    if (!user || !id) return;
    const conv: Conversation = {
      id,
      title: title || convTitle,
      userId: user.id,
      messages: msgs,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: chatMode,
      providerId: activeProviderId,
      personality: chatMode === "personality" ? personality : undefined,
    };
    await saveConversation(conv);
  };

  const canSendMessage = () => {
    if (!user) return false;
    if (chatMode === "normal") {
      if (isGuest) return true;
      const totalAllowed = user.freeTrialMessages + user.credits;
      return user.usedMessages < totalAllowed;
    }
    if (isGuest) return guestChatsRemaining > 0;
    const totalAllowed = user.freeTrialMessages + user.credits;
    return user.usedMessages < totalAllowed;
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming || !user) return;

    if (!canSendMessage()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (isGuest) {
        router.push("/auth");
      }
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const currentMessages = [...messages];
    const userMessage: ChatMessage = {
      id: uniqueId(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);
    setShowTyping(true);

    if (chatMode === "personality") {
      if (isGuest) {
        await incrementGuestChats();
      } else {
        const updatedUser = { ...user, usedMessages: user.usedMessages + 1 };
        await updateUser(updatedUser);
      }
    } else {
      if (!isGuest) {
        const updatedUser = { ...user, usedMessages: user.usedMessages + 1 };
        await updateUser(updatedUser);
      }
    }

    let newTitle = convTitle;
    if (currentMessages.length === 0) {
      newTitle = text.length > 30 ? text.slice(0, 30) + "..." : text;
      setConvTitle(newTitle);
    }

    let fullContent = "";
    let assistantAdded = false;

    try {
      const baseUrl = getApiUrl();
      const chatHistory = [
        ...currentMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: text },
      ];

      if (chatMode === "normal") {
        const response = await fetch(`${baseUrl}api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({ messages: chatHistory, providerId: activeProviderId }),
        });

        if (!response.ok) throw new Error("Failed to get response");

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullContent += parsed.content;

                if (!assistantAdded) {
                  setShowTyping(false);
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: uniqueId(),
                      role: "assistant",
                      content: fullContent,
                      createdAt: new Date().toISOString(),
                    },
                  ]);
                  assistantAdded = true;
                } else {
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      content: fullContent,
                    };
                    return updated;
                  });
                }
              }
            } catch {}
          }
        }
      } else {
        const deviceId = await getDeviceId();
        const response = await fetch(`${baseUrl}api/mascot-chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({ messages: chatHistory, userId: user?.id || "guest", personality, deviceId }),
        });

        if (!response.ok) throw new Error("Failed to get response");

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.limitReached && isGuest) {
                fullContent = parsed.content || "You've used all your free messages! Sign up to continue.";
                setShowTyping(false);
                setMessages((prev) => [
                  ...prev,
                  {
                    id: uniqueId(),
                    role: "assistant",
                    content: fullContent,
                    createdAt: new Date().toISOString(),
                  },
                ]);
                assistantAdded = true;
                setTimeout(() => {
                  Alert.alert(
                    "Free Messages Used",
                    "Sign up to continue chatting with the CF crew and unlock unlimited features!",
                    [
                      { text: "Maybe Later", style: "cancel" },
                      { text: "Sign Up", onPress: () => router.push("/auth") },
                    ]
                  );
                }, 1500);
                continue;
              }
              if (parsed.content) {
                fullContent += parsed.content;

                if (!assistantAdded) {
                  setShowTyping(false);
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: uniqueId(),
                      role: "assistant",
                      content: fullContent,
                      createdAt: new Date().toISOString(),
                    },
                  ]);
                  assistantAdded = true;
                } else {
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      content: fullContent,
                    };
                    return updated;
                  });
                }
              }
            } catch {}
          }
        }
      }
    } catch {
      setShowTyping(false);
      if (!assistantAdded) {
        setMessages((prev) => [
          ...prev,
          {
            id: uniqueId(),
            role: "assistant",
            content: "Sorry, I encountered an error. Please try again.",
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } finally {
      setIsStreaming(false);
      setShowTyping(false);
      setMessages((current) => {
        saveMessages(current, newTitle);
        return current;
      });
    }
  };

  const currentPersonality = PERSONALITIES[personality];
  const reversedMessages = [...messages].reverse();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const daysRemaining = matrixSettings.expiresAt
    ? Math.max(0, Math.ceil((new Date(matrixSettings.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return (
    <View style={styles.container}>
      {!!isMatrixActive && (
        <MatrixRain color={matrixSettings.color} visible={true} />
      )}

      <View style={[styles.headerBar, { paddingTop: topInset + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </Pressable>
        {chatMode === "normal" ? (
          <View style={styles.headerCenter}>
            <View style={[styles.headerAvatar, { borderColor: NORMAL_ACCENT + "80", backgroundColor: NORMAL_ACCENT }]}>
              <Ionicons name="chatbubbles" size={18} color="#FFFFFF" />
            </View>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {convTitle}
              </Text>
              <Text style={[styles.headerSubtitle, { color: NORMAL_ACCENT }]}>
                {providerDisplayName}
              </Text>
            </View>
          </View>
        ) : (
          <Pressable style={styles.headerCenter} onPress={() => setShowPersonalityPicker(true)}>
            <View style={[styles.headerAvatar, { borderColor: currentPersonality.color + "80" }]}>
              <Image source={MASCOT_IMAGES[personality]} style={styles.headerAvatarImage} />
            </View>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {convTitle}
              </Text>
              <Text style={[styles.headerSubtitle, { color: currentPersonality.color }]}>
                {currentPersonality.name}
              </Text>
            </View>
          </Pressable>
        )}
        {chatMode === "personality" && (
          <Pressable onPress={() => setShowPersonalityPicker(true)} style={styles.personalityBtn}>
            <Ionicons name="people-outline" size={20} color={C.textTertiary} />
          </Pressable>
        )}
        <Pressable onPress={() => setShowMatrixModal(true)} style={styles.matrixBtn}>
          <Ionicons
            name={isMatrixActive ? "grid" : "grid-outline"}
            size={20}
            color={isMatrixActive ? (matrixSettings.color === "green" ? "#00FF41" : matrixSettings.color === "red" ? "#FF073A" : "#00D4FF") : C.textTertiary}
          />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        {messages.length === 0 ? (
          <ScrollView
            contentContainerStyle={[styles.messageList, styles.emptyContent]}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {chatMode === "normal" ? (
              <View style={styles.emptyChat}>
                <View style={[styles.normalAvatarLarge, { backgroundColor: NORMAL_ACCENT }]}>
                  <Ionicons name="chatbubbles" size={48} color="#FFFFFF" />
                </View>
                <Text style={[styles.emptyChatTitle, { color: NORMAL_ACCENT }]}>
                  CFGPT
                </Text>
                <Text style={styles.emptyChatTagline}>
                  {providerDisplayName}
                </Text>
                <View style={styles.suggestionsWrap}>
                  {NORMAL_SUGGESTIONS.map((suggestion, idx) => (
                    <Pressable
                      key={idx}
                      style={[styles.suggestionChip, { borderColor: NORMAL_ACCENT + "40" }]}
                      onPress={() => setInput(suggestion)}
                    >
                      <Ionicons name="chatbubble-outline" size={14} color={NORMAL_ACCENT} />
                      <Text style={styles.suggestionText}>{suggestion}</Text>
                    </Pressable>
                  ))}
                </View>
                {!isMatrixActive && (
                  <Pressable style={styles.matrixPromo} onPress={() => setShowMatrixModal(true)}>
                    <Ionicons name="grid" size={16} color="#00FF41" />
                    <Text style={styles.matrixPromoText}>
                      Try Matrix background - {MATRIX_COST} credit for {MATRIX_DURATION_DAYS} days
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View style={styles.emptyChat}>
                <View style={[styles.mascotContainer, { borderColor: currentPersonality.color + "50" }]}>
                  <Image
                    source={MASCOT_IMAGES[personality]}
                    style={styles.mascotImage}
                    resizeMode="cover"
                  />
                </View>
                <Text style={[styles.emptyChatTitle, { color: currentPersonality.color }]}>
                  {currentPersonality.name}
                </Text>
                <Text style={styles.emptyChatTagline}>
                  {currentPersonality.tagline}
                </Text>
                <View style={styles.suggestionsWrap}>
                  {SUGGESTIONS[personality].map((suggestion, idx) => (
                    <Pressable
                      key={idx}
                      style={[styles.suggestionChip, { borderColor: currentPersonality.color + "40" }]}
                      onPress={() => setInput(suggestion)}
                    >
                      <Ionicons name={currentPersonality.icon as any} size={14} color={currentPersonality.color} />
                      <Text style={styles.suggestionText}>{suggestion}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable style={styles.switchHintRow} onPress={() => setShowPersonalityPicker(true)}>
                  {(Object.keys(PERSONALITIES) as PersonalityId[]).map((pid) => (
                    <View
                      key={pid}
                      style={[styles.switchHintAvatar, pid === personality && { borderColor: PERSONALITIES[pid].color, borderWidth: 2 }]}
                    >
                      <Image source={MASCOT_IMAGES[pid]} style={styles.switchHintImage} />
                    </View>
                  ))}
                  <Text style={styles.switchHintText}>switch</Text>
                  <Ionicons name="chevron-forward" size={12} color={C.textTertiary} />
                </Pressable>
                {!isMatrixActive && (
                  <Pressable style={styles.matrixPromo} onPress={() => setShowMatrixModal(true)}>
                    <Ionicons name="grid" size={16} color="#00FF41" />
                    <Text style={styles.matrixPromoText}>
                      Try Matrix background - {MATRIX_COST} credit for {MATRIX_DURATION_DAYS} days
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </ScrollView>
        ) : (
          <FlatList
            data={reversedMessages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <MessageBubble message={item} personality={personality} chatMode={chatMode} />}
            inverted
            ListHeaderComponent={showTyping ? <TypingIndicator personality={personality} chatMode={chatMode} /> : null}
            contentContainerStyle={styles.messageList}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        )}

        <View
          style={[styles.inputBar, { paddingBottom: Platform.OS === "web" ? 10 : Math.max(insets.bottom, 8) }]}
        >
          {chatMode === "personality" && isGuest && guestChatsRemaining > 0 && guestChatsRemaining <= 3 && (
            <View style={styles.noCreditsBar}>
              <Ionicons name="flash" size={14} color={C.warning} />
              <Text style={styles.noCreditsText}>
                {guestChatsRemaining} free {guestChatsRemaining === 1 ? "message" : "messages"} left
              </Text>
              <Pressable onPress={() => router.push("/auth")}>
                <Text style={[styles.noCreditsText, { color: C.tint, fontFamily: "Inter_600SemiBold" }]}>Sign Up</Text>
              </Pressable>
            </View>
          )}
          {!canSendMessage() && (
            <View style={styles.noCreditsBar}>
              <Ionicons name="alert-circle" size={14} color={C.warning} />
              <Text style={styles.noCreditsText}>
                {isGuest ? "Free messages used up. Sign up!" : "No credits remaining"}
              </Text>
              {isGuest ? (
                <Pressable onPress={() => router.push("/auth")}>
                  <Text style={[styles.noCreditsText, { color: C.tint, fontFamily: "Inter_600SemiBold" }]}>Sign Up</Text>
                </Pressable>
              ) : (
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable onPress={() => router.push("/credits")}>
                    <Text style={[styles.noCreditsText, { color: C.accent, fontFamily: "Inter_600SemiBold" }]}>Buy</Text>
                  </Pressable>
                  <Pressable onPress={() => router.push("/credits")}>
                    <Text style={[styles.noCreditsText, { color: "#10B981", fontFamily: "Inter_600SemiBold" }]}>Earn Free</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              style={styles.textInput}
              value={input}
              onChangeText={setInput}
              placeholder={
                canSendMessage()
                  ? chatMode === "normal" ? "Message CFGPT..." : PLACEHOLDERS[personality]
                  : "No credits remaining"
              }
              placeholderTextColor={C.placeholder}
              multiline
              maxLength={2000}
              blurOnSubmit={false}
              editable={canSendMessage()}
            />
            <Pressable
              onPress={() => {
                handleSend();
                inputRef.current?.focus();
              }}
              disabled={!input.trim() || isStreaming || !canSendMessage()}
              style={({ pressed }) => [
                styles.sendBtn,
                {
                  backgroundColor:
                    input.trim() && !isStreaming && canSendMessage()
                      ? chatMode === "normal" ? NORMAL_ACCENT : C.tint
                      : C.card,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              {isStreaming ? (
                <ActivityIndicator size="small" color={C.textSecondary} />
              ) : (
                <Ionicons
                  name="arrow-up"
                  size={20}
                  color={
                    input.trim() && canSendMessage() ? "#FFF" : C.textTertiary
                  }
                />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={showPersonalityPicker} transparent animationType="fade" onRequestClose={() => setShowPersonalityPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowPersonalityPicker(false)}>
          <View style={styles.personalityModalCard} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose Character</Text>
              <Pressable onPress={() => setShowPersonalityPicker(false)}>
                <Ionicons name="close" size={24} color={C.textSecondary} />
              </Pressable>
            </View>
            <View style={styles.personalityList}>
              {(Object.keys(PERSONALITIES) as PersonalityId[]).map((pid) => {
                const p = PERSONALITIES[pid];
                const isSelected = pid === personality;
                return (
                  <Pressable
                    key={pid}
                    style={[
                      styles.personalityCard,
                      { borderColor: isSelected ? p.color : C.border },
                      isSelected && { backgroundColor: p.color + "10", shadowColor: p.color, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
                    ]}
                    onPress={() => {
                      handlePersonalityChange(pid);
                      setShowPersonalityPicker(false);
                    }}
                  >
                    <View style={[styles.personalityAvatarWrap, { borderColor: p.color + "60" }]}>
                      <Image source={MASCOT_IMAGES[pid]} style={styles.personalityAvatarImg} />
                    </View>
                    <View style={styles.personalityInfo}>
                      <Text style={[styles.personalityName, { color: p.color }]}>{p.name}</Text>
                      <Text style={styles.personalityTagline}>{p.tagline}</Text>
                      <Text style={styles.personalityDesc}>{p.description}</Text>
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={22} color={p.color} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={showMatrixModal} transparent animationType="fade" onRequestClose={() => setShowMatrixModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowMatrixModal(false)}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Matrix Background</Text>
              <Pressable onPress={() => setShowMatrixModal(false)}>
                <Ionicons name="close" size={24} color={C.textSecondary} />
              </Pressable>
            </View>

            <Text style={styles.modalDesc}>
              Add a cinematic Matrix-style code rain behind your chat messages. Choose your color and watch the code fall.
            </Text>

            {isMatrixActive ? (
              <>
                <View style={styles.activeStatus}>
                  <Ionicons name="checkmark-circle" size={20} color={C.success} />
                  <Text style={styles.activeStatusText}>Active - {daysRemaining} {daysRemaining === 1 ? "day" : "days"} remaining</Text>
                </View>

                <Text style={styles.colorSectionTitle}>Change Color</Text>
                <View style={styles.colorRow}>
                  <ColorOption
                    label="Green"
                    color="#00FF41"
                    selected={matrixSettings.color === "green"}
                    onPress={() => handleChangeColor("green")}
                  />
                  <ColorOption
                    label="Red"
                    color="#FF073A"
                    selected={matrixSettings.color === "red"}
                    onPress={() => handleChangeColor("red")}
                  />
                  <ColorOption
                    label="Blue"
                    color="#00D4FF"
                    selected={matrixSettings.color === "blue"}
                    onPress={() => handleChangeColor("blue")}
                  />
                </View>

                <Pressable style={styles.toggleBtn} onPress={handleToggleMatrix}>
                  <Ionicons name={matrixSettings.enabled ? "eye-off" : "eye"} size={18} color={C.text} />
                  <Text style={styles.toggleBtnText}>
                    {matrixSettings.enabled ? "Turn Off" : "Turn On"}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.priceBadge}>
                  <Ionicons name="flash" size={16} color={C.warning} />
                  <Text style={styles.priceText}>{MATRIX_COST} credit for {MATRIX_DURATION_DAYS} days</Text>
                </View>

                <Text style={styles.colorSectionTitle}>Choose Your Color</Text>
                <View style={styles.colorRow}>
                  <Pressable style={[styles.colorActivateCard, { borderColor: "#00FF41" }]} onPress={() => handleActivateMatrix("green")}>
                    <View style={[styles.colorPreview, { backgroundColor: "#00FF41" }]} />
                    <Text style={[styles.colorActivateLabel, { color: "#00FF41" }]}>Matrix Green</Text>
                    <Text style={styles.colorActivateHint}>Classic</Text>
                  </Pressable>
                  <Pressable style={[styles.colorActivateCard, { borderColor: "#FF073A" }]} onPress={() => handleActivateMatrix("red")}>
                    <View style={[styles.colorPreview, { backgroundColor: "#FF073A" }]} />
                    <Text style={[styles.colorActivateLabel, { color: "#FF073A" }]}>Red Code</Text>
                    <Text style={styles.colorActivateHint}>Intense</Text>
                  </Pressable>
                  <Pressable style={[styles.colorActivateCard, { borderColor: "#00D4FF" }]} onPress={() => handleActivateMatrix("blue")}>
                    <View style={[styles.colorPreview, { backgroundColor: "#00D4FF" }]} />
                    <Text style={[styles.colorActivateLabel, { color: "#00D4FF" }]}>Cyber Blue</Text>
                    <Text style={styles.colorActivateHint}>Cool</Text>
                  </Pressable>
                </View>

                <Text style={styles.modalHint}>Tap a color to activate</Text>
              </>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function ColorOption({ label, color, selected, onPress }: { label: string; color: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.colorChip, selected && { borderColor: color, borderWidth: 2 }]} onPress={onPress}>
      <View style={[styles.colorDot, { backgroundColor: color }]} />
      <Text style={[styles.colorLabel, { color: selected ? color : C.textSecondary }]}>{label}</Text>
      {selected && <Ionicons name="checkmark" size={14} color={color} />}
    </Pressable>
  );
}

function MessageBubble({ message, personality, chatMode }: { message: ChatMessage; personality: PersonalityId; chatMode: "personality" | "normal" }) {
  const isUser = message.role === "user";
  const p = PERSONALITIES[personality];
  return (
    <View
      style={[
        styles.bubbleContainer,
        isUser ? styles.bubbleContainerUser : styles.bubbleContainerAssistant,
      ]}
    >
      {!isUser && chatMode === "normal" && (
        <View style={[styles.avatarSmall, { backgroundColor: NORMAL_ACCENT, borderColor: NORMAL_ACCENT + "60", borderWidth: 1.5 }]}>
          <Ionicons name="chatbubbles" size={14} color="#FFFFFF" />
        </View>
      )}
      {!isUser && chatMode === "personality" && (
        <View style={[styles.avatarSmall, { borderColor: p.color + "60", borderWidth: 1.5 }]}>
          <Image source={MASCOT_IMAGES[personality]} style={styles.avatarSmallImage} />
        </View>
      )}
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
        ]}
      >
        <Text
          style={[
            styles.bubbleText,
            isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant,
          ]}
        >
          {message.content}
        </Text>
      </View>
    </View>
  );
}

function TypingIndicator({ personality, chatMode }: { personality: PersonalityId; chatMode: "personality" | "normal" }) {
  const p = PERSONALITIES[personality];
  return (
    <View style={[styles.bubbleContainer, styles.bubbleContainerAssistant]}>
      {chatMode === "normal" ? (
        <View style={[styles.avatarSmall, { backgroundColor: NORMAL_ACCENT, borderColor: NORMAL_ACCENT + "60", borderWidth: 1.5 }]}>
          <Ionicons name="chatbubbles" size={14} color="#FFFFFF" />
        </View>
      ) : (
        <View style={[styles.avatarSmall, { borderColor: p.color + "60", borderWidth: 1.5 }]}>
          <Image source={MASCOT_IMAGES[personality]} style={styles.avatarSmallImage} />
        </View>
      )}
      <View style={[styles.bubble, styles.bubbleAssistant]}>
        <View style={styles.typingDots}>
          <View style={styles.dot} />
          <View style={[styles.dot, { opacity: 0.6 }]} />
          <View style={[styles.dot, { opacity: 0.3 }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: C.backgroundSecondary + "E6",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    zIndex: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 4,
  },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: C.text,
  },
  headerSubtitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
  },
  personalityBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  matrixBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  messageList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingBottom: 20,
  },
  emptyChat: {
    alignItems: "center",
    gap: 6,
  },
  normalAvatarLarge: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  mascotContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: "hidden",
    marginBottom: 6,
    borderWidth: 2,
  },
  mascotImage: {
    width: 96,
    height: 96,
  },
  emptyChatTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
  },
  emptyChatTagline: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: C.textSecondary,
  },
  suggestionsWrap: {
    width: "100%",
    paddingHorizontal: 16,
    gap: 6,
    marginTop: 10,
  },
  suggestionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: C.card + "80",
    borderWidth: 1,
  },
  suggestionText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: C.text,
    flex: 1,
  },
  switchHintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  switchHintAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
  },
  switchHintImage: {
    width: 26,
    height: 26,
  },
  switchHintText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: C.textTertiary,
    marginLeft: 2,
  },
  matrixPromo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#00FF41" + "10",
    borderWidth: 1,
    borderColor: "#00FF41" + "30",
  },
  matrixPromoText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#00FF41",
  },
  bubbleContainer: {
    flexDirection: "row",
    marginVertical: 4,
    gap: 8,
    maxWidth: "85%",
  },
  bubbleContainerUser: {
    alignSelf: "flex-end",
  },
  bubbleContainerAssistant: {
    alignSelf: "flex-start",
  },
  avatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end",
    backgroundColor: C.card,
  },
  avatarSmallImage: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "100%",
  },
  bubbleUser: {
    backgroundColor: C.tint,
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: C.card + "E6",
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
  },
  bubbleTextUser: {
    fontFamily: "Inter_400Regular",
    color: "#FFF",
  },
  bubbleTextAssistant: {
    fontFamily: "Inter_400Regular",
    color: C.text,
  },
  typingDots: {
    flexDirection: "row",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.textSecondary,
  },
  inputBar: {
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: "#111827",
    borderTopWidth: 1,
    borderTopColor: "rgba(0, 212, 170, 0.2)",
    zIndex: 10,
  },
  noCreditsBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.warning + "15",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 8,
  },
  noCreditsText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.warning,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: "#1a2236",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingRight: 12,
    color: "#FFFFFF",
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "rgba(0, 212, 170, 0.4)",
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: C.card,
    borderRadius: 24,
    padding: 24,
    width: "100%",
    maxWidth: 380,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  personalityModalCard: {
    backgroundColor: C.backgroundSecondary,
    borderRadius: 24,
    padding: 20,
    width: "100%",
    maxWidth: 380,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: C.text,
  },
  modalDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  personalityList: {
    gap: 10,
  },
  personalityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: C.card,
    borderWidth: 1.5,
  },
  personalityAvatarWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: "hidden",
    borderWidth: 2,
  },
  personalityAvatarImg: {
    width: 60,
    height: 60,
  },
  personalityInfo: {
    flex: 1,
    gap: 2,
  },
  personalityName: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  personalityTagline: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: C.textSecondary,
  },
  personalityDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: C.textTertiary,
    marginTop: 2,
  },
  priceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.warning + "18",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: C.warning + "30",
  },
  priceText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.warning,
  },
  activeStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.success + "15",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: C.success + "30",
  },
  activeStatusText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.success,
  },
  colorSectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.text,
    marginBottom: 10,
  },
  colorRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  colorChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: C.backgroundSecondary,
    borderWidth: 1,
    borderColor: C.border,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  colorLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  colorActivateCard: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.backgroundSecondary,
    borderWidth: 1.5,
  },
  colorPreview: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  colorActivateLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  colorActivateHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: C.textTertiary,
  },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: C.backgroundSecondary,
    borderWidth: 1,
    borderColor: C.border,
  },
  toggleBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: C.text,
  },
  modalHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textTertiary,
    textAlign: "center",
  },
});
