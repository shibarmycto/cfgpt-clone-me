import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  FlatList,
  Platform,
  Alert,
  Modal,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { fetch } from "expo/fetch";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl, apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

const C = Colors.light;

type BuildTab = "agent" | "files" | "deploy" | "support";

interface BuildProject {
  id: string;
  userId: string;
  name: string;
  description: string;
  files: Record<string, string>;
  deployed: boolean;
  messages: BuildMessage[];
  previewSlug?: string;
}

interface BuildMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  files?: Record<string, string>;
  previewUrl?: string;
  previewDirect?: string;
}

export default function BuildScreen() {
  const insets = useSafeAreaInsets();
  const { user, updateUser, isGuest } = useAuth();
  const [activeTab, setActiveTab] = useState<BuildTab>("agent");
  const [project, setProject] = useState<BuildProject | null>(null);
  const [projectName, setProjectName] = useState("");
  const [messages, setMessages] = useState<BuildMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubToken, setGithubToken] = useState("");
  const [repoName, setRepoName] = useState("");
  const [pushing, setPushing] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [sendingSupport, setSendingSupport] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showDomainModal, setShowDomainModal] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projects, setProjects] = useState<BuildProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [attachedImages, setAttachedImages] = useState<{ uri: string; base64?: string; name: string }[]>([]);
  const flatListRef = useRef<FlatList>(null);

  const userId = user?.id || "guest";
  const credits = user?.credits || 0;
  const isRegistered = !!user && !isGuest;
  const autoCreatedRef = useRef(false);

  const getPreviewUrl = useCallback(() => {
    if (!project?.previewSlug) return null;
    return `https://${project.previewSlug}.cfgpt.org`;
  }, [project?.previewSlug]);

  const getPreviewDirectUrl = useCallback(() => {
    if (!project) return null;
    const base = getApiUrl();
    return `${base}/preview/${project.previewSlug || project.id}`;
  }, [project]);

  const openPreview = useCallback(() => {
    const url = getPreviewDirectUrl();
    if (url) {
      Linking.openURL(url);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [getPreviewDirectUrl]);

  useEffect(() => {
    loadProjects();
    checkGithub();
  }, [userId]);

  useEffect(() => {
    if (!project && !autoCreatedRef.current && !loadingProjects) {
      autoCreatedRef.current = true;
      autoCreateProject();
    }
  }, [loadingProjects]);

  const autoCreateProject = async () => {
    try {
      const res = await apiRequest("POST", "/api/build/projects", {
        userId,
        name: "My Project",
        description: "",
      });
      const data = await res.json();
      if (data.project) {
        setProject(data.project);
        setMessages([{
          id: "welcome",
          role: "assistant",
          content: "Hey! I'm your CFGPT Build Agent. Tell me what you want to build - websites, apps, landing pages, dashboards, APIs - and I'll generate the complete code for you. What shall we create?",
          createdAt: new Date().toISOString(),
        }]);
      }
    } catch {
      setProject({
        id: "local_" + Date.now(),
        userId,
        name: "My Project",
        description: "",
        files: {},
        deployed: false,
        messages: [],
      });
      setMessages([{
        id: "welcome",
        role: "assistant",
        content: "Hey! I'm your CFGPT Build Agent. Tell me what you want to build - websites, apps, landing pages, dashboards, APIs - and I'll generate the complete code for you. What shall we create?",
        createdAt: new Date().toISOString(),
      }]);
    }
  };

  const loadProjects = async () => {
    try {
      setLoadingProjects(true);
      const res = await apiRequest("GET", `/api/build/projects?userId=${userId}`);
      const data = await res.json();
      setProjects(Array.isArray(data) ? data : []);
    } catch {} finally {
      setLoadingProjects(false);
    }
  };

  const checkGithub = async () => {
    try {
      const res = await apiRequest("GET", `/api/build/github/status?userId=${userId}`);
      const data = await res.json();
      setGithubConnected(data.connected);
    } catch {}
  };

  const createNewProject = async () => {
    if (!projectName.trim()) return;
    try {
      const res = await apiRequest("POST", "/api/build/projects", {
        userId,
        name: projectName.trim(),
        description: "",
      });
      const data = await res.json();
      if (data.project) {
        setProject(data.project);
        setMessages([]);
        setProjectName("");
        setShowNewProject(false);
        loadProjects();
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to create project");
    }
  };

  const openProject = async (p: BuildProject) => {
    try {
      const res = await apiRequest("GET", `/api/build/projects/${p.id}`);
      const data = await res.json();
      setProject(data);
      setMessages(data.messages || []);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setProject(p);
      setMessages(p.messages || []);
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
        base64: true,
        allowsMultipleSelection: false,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const name = asset.fileName || `image_${Date.now()}.jpg`;
        setAttachedImages(prev => [...prev, { uri: asset.uri, base64: asset.base64 || undefined, name }]);
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e: any) {
      Alert.alert("Error", "Could not pick image");
    }
  };

  const removeImage = (index: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index));
  };

  const sendMessage = async () => {
    if ((!inputText.trim() && attachedImages.length === 0) || isStreaming || !project) return;

    if (isRegistered && credits < 1) {
      Alert.alert("No Credits", "You need at least 1 credit to send a message. Purchase credits in the Earn tab.");
      return;
    }

    let messageContent = inputText.trim();
    if (attachedImages.length > 0) {
      const imageNames = attachedImages.map(img => img.name).join(", ");
      messageContent = messageContent
        ? `${messageContent}\n\n[Attached images: ${imageNames}]`
        : `[Attached images: ${imageNames}]`;
    }

    const userMsg: BuildMessage = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      role: "user",
      content: messageContent,
      createdAt: new Date().toISOString(),
    };

    const currentInput = messageContent;
    const currentImages = [...attachedImages];
    setMessages(prev => [...prev, userMsg]);
    setInputText("");
    setAttachedImages([]);
    setIsStreaming(true);
    setStreamingContent("");

    if (isRegistered && user) {
      const updated = { ...user, credits: Math.max(0, user.credits - 1) };
      updateUser(updated);
    }

    try {
      let activeProjectId = project.id;
      if (activeProjectId.startsWith("local_")) {
        const createRes = await apiRequest("POST", "/api/build/projects", {
          userId,
          name: project.name || "My Project",
          description: "",
        });
        const createData = await createRes.json();
        if (createData.project) {
          activeProjectId = createData.project.id;
          setProject(prev => prev ? { ...prev, id: activeProjectId } : prev);
        }
      }

      const baseUrl = getApiUrl();
      const url = new URL("/api/build/chat", baseUrl);
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProjectId,
          message: currentInput,
          files: project.files,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || `Server error ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No streaming support");

      const decoder = new TextDecoder();
      let fullContent = "";
      let newFiles: Record<string, string> = {};
      let previewUrl = "";
      let previewDirect = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;

          try {
            const parsed = JSON.parse(payload);
            if (parsed.content) {
              fullContent += parsed.content;
              setStreamingContent(fullContent);
            }
            if (parsed.files) {
              newFiles = { ...newFiles, ...parsed.files };
            }
            if (parsed.previewUrl) {
              previewUrl = parsed.previewUrl;
              previewDirect = parsed.previewDirect || "";
            }
            if (parsed.error) {
              throw new Error(parsed.error);
            }
          } catch (parseErr: any) {
            if (parseErr.message && !parseErr.message.includes("JSON")) throw parseErr;
          }
        }
      }

      const assistantMsg: BuildMessage = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        role: "assistant",
        content: fullContent || "I didn't generate a response. Please try again with more detail.",
        createdAt: new Date().toISOString(),
        files: Object.keys(newFiles).length > 0 ? newFiles : undefined,
        previewUrl: previewUrl || undefined,
        previewDirect: previewDirect || undefined,
      };

      setMessages(prev => [...prev, assistantMsg]);

      if (Object.keys(newFiles).length > 0) {
        setProject(prev => prev ? { ...prev, files: { ...prev.files, ...newFiles } } : prev);
      }
    } catch (e: any) {
      console.log("Build chat error:", e);
      const errMsg: BuildMessage = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        role: "assistant",
        content: "Something went wrong: " + (e.message || "Unknown error") + ". Please try again.",
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
    }
  };

  const connectGithub = async () => {
    if (!githubToken.trim()) return;
    try {
      await apiRequest("POST", "/api/build/github/connect", {
        userId,
        token: githubToken.trim(),
      });
      setGithubConnected(true);
      setGithubToken("");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const disconnectGithub = async () => {
    try {
      await apiRequest("DELETE", "/api/build/github/disconnect", { userId });
      setGithubConnected(false);
    } catch {}
  };

  const pushToGithub = async () => {
    if (!repoName.trim() || !project) return;
    setPushing(true);
    try {
      const res = await apiRequest("POST", "/api/build/github/push", {
        userId,
        repoName: repoName.trim(),
        projectId: project.id,
        commitMessage: `Build update from CFGPT`,
      });
      const data = await res.json();
      if (data.success) {
        Alert.alert("Pushed!", `Files pushed to GitHub.\n${data.url}`);
        setProject(prev => prev ? { ...prev, githubRepo: data.url } : prev);
      } else {
        Alert.alert("Error", data.error || "Push failed");
      }
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setPushing(false);
    }
  };

  const handleDeploy = async () => {
    if (!project || !isRegistered) return;
    if (credits < 50) {
      Alert.alert("Not Enough Credits", "You need 50 credits to deploy. Purchase credits in the Earn tab.");
      return;
    }
    if (Object.keys(project.files).length === 0) {
      Alert.alert("No Files", "Build something first before deploying.");
      return;
    }

    setDeploying(true);
    try {
      if (user) {
        const updated = { ...user, credits: user.credits - 50 };
        updateUser(updated);
      }

      await apiRequest("POST", "/api/build/deploy", {
        projectId: project.id,
        domain: domainInput || undefined,
        userId,
        userName: user?.name || "",
      });

      setProject(prev => prev ? { ...prev, deployed: true } : prev);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Deployed!", "Your project has been deployed successfully.");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setDeploying(false);
    }
  };

  const handleDomainPurchase = async () => {
    if (!domainInput.trim()) return;
    try {
      await apiRequest("POST", "/api/domains/request", {
        userId,
        userName: user?.name || "",
        userEmail: user?.email || "",
        domain: domainInput.trim(),
      });
      Alert.alert(
        "Domain Requested!",
        `Your request for "${domainInput.trim()}" has been sent to our team. You'll be notified once it's set up. Please complete payment via PayPal to proceed.`
      );
      setShowDomainModal(false);
      setDomainInput("");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const handlePayPalDomain = () => {
    Linking.openURL("https://www.paypal.com/paypalme/cfgpt/5");
  };

  const sendSupportMsg = async () => {
    if (!supportSubject.trim() || !supportMessage.trim()) return;
    setSendingSupport(true);
    try {
      await apiRequest("POST", "/api/support/messages", {
        userId,
        userName: user?.name || "Guest",
        userEmail: user?.email || "",
        subject: supportSubject.trim(),
        message: supportMessage.trim(),
      });
      Alert.alert("Sent!", "Your support message has been sent. Our team will get back to you soon.");
      setSupportSubject("");
      setSupportMessage("");
      setShowSupportModal(false);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSendingSupport(false);
    }
  };

  const renderMessage = useCallback(({ item }: { item: BuildMessage }) => {
    const isUser = item.role === "user";
    const displayContent = item.content.replace(/\n\n---\nYour site is live at:.*(\n.*)?$/s, "").trim();
    return (
      <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAi]}>
        {!isUser && (
          <View style={styles.aiAvatar}>
            <Ionicons name="construct" size={14} color={C.tint} />
          </View>
        )}
        <View style={[styles.msgBubble, isUser ? styles.msgBubbleUser : styles.msgBubbleAi]}>
          <Text style={[styles.msgText, isUser && styles.msgTextUser]}>{displayContent}</Text>
          {item.files && Object.keys(item.files).length > 0 && (
            <View style={styles.filesIndicator}>
              <Ionicons name="document-text" size={12} color={C.tint} />
              <Text style={styles.filesCount}>
                {Object.keys(item.files).length} file{Object.keys(item.files).length > 1 ? "s" : ""} generated
              </Text>
            </View>
          )}
          {item.previewUrl && (
            <Pressable
              style={styles.previewLinkBox}
              onPress={() => {
                const directUrl = item.previewDirect
                  ? `${getApiUrl()}${item.previewDirect}`
                  : item.previewUrl!;
                Linking.openURL(directUrl);
              }}
            >
              <View style={styles.previewLinkInner}>
                <Ionicons name="globe" size={16} color="#fff" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.previewLinkLabel}>Live Preview</Text>
                  <Text style={styles.previewLinkUrl} numberOfLines={1}>
                    {item.previewUrl?.replace("https://", "")}
                  </Text>
                </View>
                <Ionicons name="open-outline" size={16} color="rgba(255,255,255,0.7)" />
              </View>
            </Pressable>
          )}
        </View>
      </View>
    );
  }, []);

  const renderFileItem = useCallback(({ item }: { item: string }) => {
    const ext = item.split(".").pop() || "";
    const iconName = ext === "html" ? "logo-html5" :
      ext === "css" ? "logo-css3" :
      ext === "js" || ext === "jsx" ? "logo-javascript" :
      ext === "ts" || ext === "tsx" ? "code-slash" :
      ext === "json" ? "document" : "document-text";

    return (
      <Pressable
        style={[styles.fileItem, selectedFile === item && styles.fileItemActive]}
        onPress={() => setSelectedFile(selectedFile === item ? null : item)}
      >
        <Ionicons name={iconName as any} size={18} color={selectedFile === item ? C.tint : C.textSecondary} />
        <Text style={[styles.fileName, selectedFile === item && styles.fileNameActive]} numberOfLines={1}>
          {item}
        </Text>
      </Pressable>
    );
  }, [selectedFile]);

  const renderProjectList = () => (
    <View style={styles.projectList}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your Projects</Text>
        <Pressable style={styles.newBtn} onPress={() => setShowNewProject(true)}>
          <Ionicons name="add" size={20} color="#fff" />
        </Pressable>
      </View>

      {loadingProjects ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : projects.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="construct-outline" size={48} color={C.textTertiary} />
          <Text style={styles.emptyTitle}>No projects yet</Text>
          <Text style={styles.emptySubtitle}>Create a project and start building with AI</Text>
          <Pressable style={styles.createBtn} onPress={() => setShowNewProject(true)}>
            <Ionicons name="add-circle" size={20} color="#fff" />
            <Text style={styles.createBtnText}>New Project</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={p => p.id}
          renderItem={({ item: p }) => (
            <Pressable style={styles.projectCard} onPress={() => openProject(p)}>
              <View style={styles.projectCardHeader}>
                <View style={styles.projectIcon}>
                  <Ionicons name="folder" size={20} color={C.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projectName}>{p.name}</Text>
                  <Text style={styles.projectMeta}>
                    {Object.keys(p.files || {}).length} files
                    {p.deployed ? " | Deployed" : ""}
                  </Text>
                  {p.previewSlug && Object.keys(p.files || {}).length > 0 && (
                    <Text style={{ fontSize: 11, color: C.tint, marginTop: 2 }}>
                      {p.previewSlug}.cfgpt.org
                    </Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.textTertiary} />
              </View>
            </Pressable>
          )}
          contentContainerStyle={{ paddingBottom: 100 }}
          scrollEnabled={projects.length > 0}
        />
      )}
    </View>
  );

  const handleClearChat = () => {
    Alert.alert("Clear Chat", "Remove all messages in this conversation?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          setMessages([{
            id: "welcome_" + Date.now(),
            role: "assistant",
            content: "Chat cleared. What would you like to build?",
            createdAt: new Date().toISOString(),
          }]);
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        },
      },
    ]);
  };

  const inputBottomOffset = Platform.OS === "web" ? 74 : 60;

  const renderAgent = () => (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={["#0F1B2D", "#0A0E1A"]}
        style={styles.agentHeaderGradient}
      >
        <View style={styles.agentHeader}>
          <Pressable onPress={() => { setProject(null); setMessages([]); }} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={C.text} />
          </Pressable>
          <View style={styles.headerCenter}>
            <View style={styles.headerDot} />
            <Text style={styles.projectTitle} numberOfLines={1}>{project?.name}</Text>
          </View>
          <View style={styles.headerActions}>
            {messages.length > 1 && (
              <Pressable onPress={handleClearChat} style={styles.clearBtn}>
                <Ionicons name="trash-outline" size={16} color={C.danger} />
              </Pressable>
            )}
            {Object.keys(project?.files || {}).length > 0 && (
              <Pressable style={styles.previewBtn} onPress={openPreview}>
                <Ionicons name="eye" size={14} color="#fff" />
              </Pressable>
            )}
            <Pressable onPress={() => setShowSupportModal(true)} style={styles.headerSupportBtn}>
              <Ionicons name="help-circle-outline" size={18} color={C.textSecondary} />
            </Pressable>
            <View style={styles.creditBadge}>
              <Ionicons name="flash" size={12} color={C.warning} />
              <Text style={styles.creditText}>{credits}</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.chatArea}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={renderMessage}
          contentContainerStyle={[styles.messagesList, { paddingBottom: 80 + inputBottomOffset }]}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.agentEmpty}>
              <LinearGradient
                colors={["rgba(0,212,170,0.15)", "rgba(0,180,216,0.08)"]}
                style={styles.agentEmptyIcon}
              >
                <Ionicons name="construct" size={32} color={C.tint} />
              </LinearGradient>
              <Text style={styles.agentEmptyTitle}>CFGPT Build Agent</Text>
              <Text style={styles.agentEmptySubtitle}>
                Tell me what to build. I can create websites, apps, APIs, and more.
              </Text>
              <View style={styles.costBadge}>
                <Ionicons name="flash" size={12} color={C.warning} />
                <Text style={styles.costNote}>1 credit per message</Text>
              </View>
            </View>
          }
          ListFooterComponent={
            isStreaming ? (
              <View style={[styles.msgRow, styles.msgRowAi]}>
                <View style={styles.aiAvatar}>
                  <Ionicons name="construct" size={14} color={C.tint} />
                </View>
                <View style={[styles.msgBubble, styles.msgBubbleAi]}>
                  <Text style={styles.msgText}>{streamingContent || "Thinking..."}</Text>
                  {!streamingContent && (
                    <View style={styles.typingDots}>
                      <View style={[styles.dot, styles.dot1]} />
                      <View style={[styles.dot, styles.dot2]} />
                      <View style={[styles.dot, styles.dot3]} />
                    </View>
                  )}
                </View>
              </View>
            ) : null
          }
        />
      </View>

      <LinearGradient
        colors={["rgba(8,12,22,0)", "rgba(8,12,22,0.9)", "#080C16"]}
        style={[styles.inputGradientFade, { bottom: inputBottomOffset }]}
        pointerEvents="none"
      />
      <View style={[styles.inputBar, { bottom: inputBottomOffset }]}>
        {attachedImages.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagePreviewRow} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
            {attachedImages.map((img, idx) => (
              <View key={idx} style={styles.imageThumbWrap}>
                <Image source={{ uri: img.uri }} style={styles.imageThumb} />
                <Pressable style={styles.imageRemoveBtn} onPress={() => removeImage(idx)}>
                  <Ionicons name="close-circle" size={18} color="#FF4444" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
        <View style={styles.inputRow}>
          <Pressable
            style={styles.attachBtn}
            onPress={pickImage}
            disabled={isStreaming}
          >
            <Ionicons name="image-outline" size={20} color={isStreaming ? "rgba(100,116,139,0.4)" : C.tint} />
          </Pressable>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Describe what to build..."
            placeholderTextColor="rgba(148, 163, 184, 0.6)"
            multiline
            maxLength={4000}
            editable={!isStreaming}
            onSubmitEditing={sendMessage}
            testID="build-input"
          />
          <Pressable
            style={[styles.sendBtn, (!inputText.trim() && attachedImages.length === 0 || isStreaming) && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={(!inputText.trim() && attachedImages.length === 0) || isStreaming}
            testID="build-send"
          >
            {isStreaming ? (
              <ActivityIndicator size={16} color="#fff" />
            ) : (
              <Ionicons name="arrow-up" size={18} color="#fff" />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );

  const renderFiles = () => {
    const fileNames = Object.keys(project?.files || {});
    return (
      <View style={{ flex: 1 }}>
        <View style={styles.agentHeader}>
          <Pressable onPress={() => { setProject(null); setMessages([]); }}>
            <Ionicons name="arrow-back" size={22} color={C.text} />
          </Pressable>
          <Text style={styles.projectTitle} numberOfLines={1}>Files - {project?.name}</Text>
          {Object.keys(project?.files || {}).length > 0 && (
            <Pressable style={styles.previewBtn} onPress={openPreview}>
              <Ionicons name="eye" size={14} color="#fff" />
            </Pressable>
          )}
        </View>

        {fileNames.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="folder-open-outline" size={48} color={C.textTertiary} />
            <Text style={styles.emptyTitle}>No files yet</Text>
            <Text style={styles.emptySubtitle}>Use the Agent to build and generate files</Text>
          </View>
        ) : (
          <View style={{ flex: 1, flexDirection: Platform.OS === "web" ? "row" : "column" }}>
            <FlatList
              data={fileNames}
              keyExtractor={f => f}
              renderItem={renderFileItem}
              style={Platform.OS === "web" ? { width: 220, borderRightWidth: 1, borderRightColor: C.border } : {}}
              contentContainerStyle={{ padding: 8 }}
              scrollEnabled={fileNames.length > 0}
            />
            {selectedFile && project?.files[selectedFile] && (
              <ScrollView style={styles.codeView} contentContainerStyle={{ padding: 16 }}>
                <Text style={styles.codeText}>{project.files[selectedFile]}</Text>
              </ScrollView>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderDeploy = () => (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
      <View style={styles.agentHeader}>
        <Pressable onPress={() => { setProject(null); setMessages([]); }}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.projectTitle} numberOfLines={1}>Deploy - {project?.name}</Text>
        <View style={{ width: 30 }} />
      </View>

      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Ionicons name="eye" size={20} color={C.tint} />
          <Text style={[styles.cardTitle, { marginBottom: 0 }]}>Preview</Text>
        </View>
        {Object.keys(project?.files || {}).length > 0 ? (
          <>
            <Pressable style={styles.previewUrlBox} onPress={openPreview}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                <Ionicons name="globe" size={14} color={C.tint} />
                <Text style={styles.previewUrlText} numberOfLines={1}>
                  {project?.previewSlug}.cfgpt.org
                </Text>
              </View>
              <Ionicons name="open-outline" size={16} color={C.tint} />
            </Pressable>
            <Text style={{ fontSize: 11, color: C.textTertiary, marginTop: 6, textAlign: "center" }}>
              Free preview before you deploy
            </Text>
          </>
        ) : (
          <Text style={styles.cardSubtitle}>Build something first to see your live preview</Text>
        )}
      </View>

      {!isRegistered ? (
        <View style={styles.card}>
          <Ionicons name="lock-closed" size={32} color={C.warning} />
          <Text style={styles.cardTitle}>Registration Required</Text>
          <Text style={styles.cardSubtitle}>Sign up to deploy your projects and connect a domain.</Text>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.statBox}>
                <Text style={styles.statNumber}>{credits}</Text>
                <Text style={styles.statLabel}>Credits</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statNumber}>50</Text>
                <Text style={styles.statLabel}>To Deploy</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statNumber}>{Object.keys(project?.files || {}).length}</Text>
                <Text style={styles.statLabel}>Files</Text>
              </View>
            </View>

            <Pressable
              style={[styles.deployBtn, (credits < 50 || deploying) && styles.deployBtnDisabled]}
              onPress={handleDeploy}
              disabled={credits < 50 || deploying}
            >
              {deploying ? (
                <ActivityIndicator color="#fff" size={16} />
              ) : (
                <>
                  <Ionicons name="rocket" size={18} color="#fff" />
                  <Text style={styles.deployBtnText}>Deploy (50 Credits)</Text>
                </>
              )}
            </Pressable>

            {project?.deployed && (
              <View style={styles.deployedBadge}>
                <Ionicons name="checkmark-circle" size={16} color={C.success} />
                <Text style={styles.deployedText}>Deployed</Text>
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>GitHub</Text>
            {githubConnected ? (
              <>
                <View style={styles.connectedBadge}>
                  <Ionicons name="logo-github" size={16} color={C.success} />
                  <Text style={[styles.connectedText, { color: C.success }]}>Connected</Text>
                  <Pressable onPress={disconnectGithub}>
                    <Text style={{ color: C.danger, fontSize: 12 }}>Disconnect</Text>
                  </Pressable>
                </View>
                <TextInput
                  style={styles.fieldInput}
                  value={repoName}
                  onChangeText={setRepoName}
                  placeholder="Repository name"
                  placeholderTextColor={C.placeholder}
                />
                <Pressable
                  style={[styles.pushBtn, (!repoName.trim() || pushing) && styles.pushBtnDisabled]}
                  onPress={pushToGithub}
                  disabled={!repoName.trim() || pushing}
                >
                  {pushing ? (
                    <ActivityIndicator color="#fff" size={14} />
                  ) : (
                    <>
                      <Ionicons name="cloud-upload" size={16} color="#fff" />
                      <Text style={styles.pushBtnText}>Push to GitHub</Text>
                    </>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.cardSubtitle}>Connect your GitHub to push code and deploy.</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={githubToken}
                  onChangeText={setGithubToken}
                  placeholder="GitHub Personal Access Token"
                  placeholderTextColor={C.placeholder}
                  secureTextEntry
                />
                <Pressable
                  style={[styles.pushBtn, !githubToken.trim() && styles.pushBtnDisabled]}
                  onPress={connectGithub}
                  disabled={!githubToken.trim()}
                >
                  <Ionicons name="logo-github" size={16} color="#fff" />
                  <Text style={styles.pushBtnText}>Connect GitHub</Text>
                </Pressable>
              </>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Custom Domain</Text>
            <Text style={styles.cardSubtitle}>
              Purchase a domain for your project. We handle setup manually.
            </Text>
            <Pressable style={styles.domainBtn} onPress={() => setShowDomainModal(true)}>
              <Ionicons name="globe" size={18} color="#fff" />
              <Text style={styles.domainBtnText}>Buy Domain - {"\u00A3"}5</Text>
            </Pressable>
          </View>
        </>
      )}
    </ScrollView>
  );

  const renderTabBar = () => {
    if (!project) return null;
    const tabs: { key: BuildTab; icon: string; label: string }[] = [
      { key: "agent", icon: "construct", label: "Agent" },
      { key: "files", icon: "folder", label: "Files" },
      { key: "deploy", icon: "rocket", label: "Deploy" },
    ];
    return (
      <View style={styles.subTabBar}>
        {tabs.map(t => (
          <Pressable
            key={t.key}
            style={[styles.subTab, activeTab === t.key && styles.subTabActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <Ionicons
              name={(activeTab === t.key ? t.icon : `${t.icon}-outline`) as any}
              size={18}
              color={activeTab === t.key ? C.tint : C.textSecondary}
            />
            <Text style={[styles.subTabText, activeTab === t.key && styles.subTabTextActive]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 + insets.top : insets.top }]}>
      {renderTabBar()}

      {!project ? renderProjectList() : (
        activeTab === "agent" ? renderAgent() :
        activeTab === "files" ? renderFiles() :
        renderDeploy()
      )}

      {!project && (
        <Pressable style={styles.supportFab} onPress={() => setShowSupportModal(true)}>
          <Ionicons name="chatbubble-ellipses" size={22} color="#fff" />
        </Pressable>
      )}

      <Modal visible={showNewProject} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Project</Text>
              <Pressable onPress={() => setShowNewProject(false)}>
                <Ionicons name="close" size={24} color={C.text} />
              </Pressable>
            </View>
            <TextInput
              style={styles.fieldInput}
              value={projectName}
              onChangeText={setProjectName}
              placeholder="Project name"
              placeholderTextColor={C.placeholder}
              autoFocus
            />
            <Pressable
              style={[styles.createBtn, !projectName.trim() && { opacity: 0.5 }]}
              onPress={createNewProject}
              disabled={!projectName.trim()}
            >
              <Text style={styles.createBtnText}>Create</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showSupportModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Support</Text>
              <Pressable onPress={() => setShowSupportModal(false)}>
                <Ionicons name="close" size={24} color={C.text} />
              </Pressable>
            </View>
            <TextInput
              style={styles.fieldInput}
              value={supportSubject}
              onChangeText={setSupportSubject}
              placeholder="Subject"
              placeholderTextColor={C.placeholder}
            />
            <TextInput
              style={[styles.fieldInput, { height: 120, textAlignVertical: "top" }]}
              value={supportMessage}
              onChangeText={setSupportMessage}
              placeholder="Describe your issue..."
              placeholderTextColor={C.placeholder}
              multiline
            />
            <Pressable
              style={[styles.createBtn, (sendingSupport || !supportSubject.trim() || !supportMessage.trim()) && { opacity: 0.5 }]}
              onPress={sendSupportMsg}
              disabled={sendingSupport || !supportSubject.trim() || !supportMessage.trim()}
            >
              {sendingSupport ? (
                <ActivityIndicator color="#fff" size={14} />
              ) : (
                <Text style={styles.createBtnText}>Send Message</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showDomainModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Buy Domain</Text>
              <Pressable onPress={() => setShowDomainModal(false)}>
                <Ionicons name="close" size={24} color={C.text} />
              </Pressable>
            </View>
            <Text style={styles.domainInfo}>
              Enter your desired domain name. We'll set it up manually after payment.
              Cost: {"\u00A3"}5 via PayPal.
            </Text>
            <TextInput
              style={styles.fieldInput}
              value={domainInput}
              onChangeText={setDomainInput}
              placeholder="e.g. mywebsite.com"
              placeholderTextColor={C.placeholder}
              autoCapitalize="none"
            />
            <Pressable style={styles.paypalBtn} onPress={handlePayPalDomain}>
              <Text style={styles.paypalBtnText}>Pay {"\u00A3"}5 with PayPal</Text>
            </Pressable>
            <Pressable
              style={[styles.createBtn, { marginTop: 8 }, !domainInput.trim() && { opacity: 0.5 }]}
              onPress={handleDomainPurchase}
              disabled={!domainInput.trim()}
            >
              <Text style={styles.createBtnText}>Submit Domain Request</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  subTabBar: {
    flexDirection: "row",
    backgroundColor: C.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingHorizontal: 8,
  },
  subTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    gap: 6,
  },
  subTabActive: { borderBottomWidth: 2, borderBottomColor: C.tint },
  subTabText: { fontSize: 13, color: C.textSecondary, fontFamily: "Inter_500Medium" },
  subTabTextActive: { color: C.tint },
  projectList: { flex: 1, padding: 16 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 20, fontWeight: "700" as const, color: C.text, fontFamily: "Inter_700Bold" },
  newBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: "600" as const, color: C.text, marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: C.textSecondary, marginTop: 8, textAlign: "center" },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.tint,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginTop: 20,
    gap: 8,
  },
  createBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" as const },
  projectCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  projectCardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  projectIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  projectName: { fontSize: 16, fontWeight: "600" as const, color: C.text },
  projectMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  agentHeaderGradient: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0, 212, 170, 0.15)",
    shadowColor: "#00D4AA",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  agentHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.success,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  clearBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerSupportBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  projectTitle: { fontSize: 15, fontWeight: "600" as const, color: C.text },
  creditBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  creditText: { fontSize: 13, fontWeight: "600" as const, color: C.warning },
  chatArea: {
    flex: 1,
    backgroundColor: "#080C16",
  },
  messagesList: { padding: 16 },
  msgRow: { marginBottom: 16, flexDirection: "row", alignItems: "flex-end", gap: 10 },
  msgRowUser: { justifyContent: "flex-end" },
  msgRowAi: { justifyContent: "flex-start" },
  aiAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0, 212, 170, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(0, 212, 170, 0.25)",
  },
  msgBubble: { maxWidth: "82%", borderRadius: 20, padding: 14, paddingHorizontal: 16 },
  msgBubbleUser: {
    backgroundColor: "#00B894",
    borderBottomRightRadius: 6,
    shadowColor: "#00D4AA",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  msgBubbleAi: {
    backgroundColor: "#141E30",
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(0, 212, 170, 0.1)",
  },
  msgText: { fontSize: 14.5, lineHeight: 22, color: "#E2E8F0", fontFamily: "Inter_400Regular" },
  msgTextUser: { color: "#fff", fontFamily: "Inter_500Medium" },
  typingDots: {
    flexDirection: "row",
    gap: 5,
    marginTop: 8,
    alignItems: "center",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#00D4AA",
  },
  dot1: { opacity: 0.3 },
  dot2: { opacity: 0.55 },
  dot3: { opacity: 0.8 },
  filesIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  filesCount: { fontSize: 12, color: C.tint, fontWeight: "500" as const },
  inputGradientFade: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 40,
    zIndex: 1,
  },
  inputBar: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: "#0B1020",
    borderTopWidth: 1,
    borderTopColor: "rgba(0, 212, 170, 0.1)",
    zIndex: 2,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: "#141E30",
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontSize: 15,
    color: "#FFFFFF",
    maxHeight: 100,
    minHeight: 46,
    borderWidth: 1.5,
    borderColor: "rgba(0, 212, 170, 0.3)",
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#00B894",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#00D4AA",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  sendBtnDisabled: { backgroundColor: "rgba(100,116,139,0.2)" },
  attachBtn: {
    width: 40,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  imagePreviewRow: {
    maxHeight: 72,
  },
  imageThumbWrap: {
    width: 60,
    height: 60,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
  },
  imageThumb: {
    width: 60,
    height: 60,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(0, 212, 170, 0.2)",
  },
  imageRemoveBtn: {
    position: "absolute",
    top: -2,
    right: -2,
    backgroundColor: "#0B1020",
    borderRadius: 10,
  },
  costBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginTop: 14,
  },
  previewBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  previewUrlBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 212, 170, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(0, 212, 170, 0.25)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    width: "100%",
  },
  previewUrlText: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: C.tint,
    flex: 1,
  },
  previewLinkBox: {
    marginTop: 10,
    borderRadius: 10,
    overflow: "hidden",
  },
  previewLinkInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.tint,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  previewLinkLabel: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: "#fff",
    opacity: 0.85,
  },
  previewLinkUrl: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: "#fff",
  },
  agentEmpty: { alignItems: "center", paddingTop: 60 },
  agentEmptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  agentEmptyTitle: { fontSize: 20, fontWeight: "700" as const, color: C.text, fontFamily: "Inter_700Bold" },
  agentEmptySubtitle: {
    fontSize: 14,
    color: C.textSecondary,
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 40,
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
  },
  costNote: { fontSize: 12, color: C.warning },
  fileItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 8,
    marginBottom: 2,
  },
  fileItemActive: { backgroundColor: "rgba(0, 212, 170, 0.1)" },
  fileName: { fontSize: 13, color: C.text, flex: 1 },
  fileNameActive: { color: C.tint },
  codeView: { flex: 1, backgroundColor: C.backgroundSecondary },
  codeText: { fontFamily: Platform.OS === "web" ? "monospace" : "Courier", fontSize: 12, color: C.text, lineHeight: 18 },
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
  },
  cardRow: { flexDirection: "row", gap: 20, marginBottom: 20 },
  statBox: { alignItems: "center" },
  statNumber: { fontSize: 28, fontWeight: "700" as const, color: C.tint },
  statLabel: { fontSize: 12, color: C.textSecondary, marginTop: 4 },
  cardTitle: { fontSize: 18, fontWeight: "700" as const, color: C.text, marginBottom: 8 },
  cardSubtitle: { fontSize: 13, color: C.textSecondary, textAlign: "center", marginBottom: 16 },
  deployBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.accent,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    gap: 8,
    width: "100%",
  },
  deployBtnDisabled: { opacity: 0.5 },
  deployBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" as const },
  deployedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
  },
  deployedText: { fontSize: 14, color: C.success, fontWeight: "500" as const },
  connectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  connectedText: { fontSize: 14, fontWeight: "500" as const, flex: 1 },
  fieldInput: {
    width: "100%",
    backgroundColor: C.inputBackground,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: C.text,
    borderWidth: 1,
    borderColor: C.inputBorder,
    marginBottom: 12,
  },
  pushBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#333",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
    width: "100%",
  },
  pushBtnDisabled: { opacity: 0.5 },
  pushBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" as const },
  domainBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.purple,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    gap: 8,
    width: "100%",
  },
  domainBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" as const },
  paypalBtn: {
    backgroundColor: "#0070BA",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    width: "100%",
    alignItems: "center",
    marginBottom: 8,
  },
  paypalBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" as const },
  domainInfo: { fontSize: 13, color: C.textSecondary, textAlign: "center", marginBottom: 16 },
  supportFab: {
    position: "absolute",
    right: 20,
    bottom: 100,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: C.backgroundSecondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: "700" as const, color: C.text },
});
