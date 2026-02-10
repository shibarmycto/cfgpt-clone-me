import type { Express, Request, Response } from "express";
import { db } from "./db";
import { appUsers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ error: "Email, password, and name are required" });
      }

      const existing = await db.select().from(appUsers).where(eq(appUsers.email, email.toLowerCase()));
      if (existing.length > 0) {
        return res.status(400).json({ error: "Email already registered" });
      }

      const id = randomUUID();
      const now = new Date().toISOString();

      const [newUser] = await db.insert(appUsers).values({
        id,
        email: email.toLowerCase(),
        password,
        name,
        role: "user",
        credits: 0,
        blocked: false,
        createdAt: now,
        freeTrialMessages: 5,
        usedMessages: 0,
        freePhotoGenerations: 1,
        usedPhotoGenerations: 0,
        freeVideoGenerations: 1,
        usedVideoGenerations: 0,
      }).returning();

      const { password: _, ...userWithoutPassword } = newUser;
      res.json(userWithoutPassword);
    } catch (error: any) {
      console.error("Auth register error:", error);
      res.status(500).json({ error: error.message || "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const [found] = await db.select().from(appUsers).where(eq(appUsers.email, email.toLowerCase()));
      if (!found) {
        return res.status(401).json({ error: "Account not found" });
      }
      if (found.password !== password) {
        return res.status(401).json({ error: "Incorrect password" });
      }
      if (found.blocked) {
        return res.status(403).json({ error: "Account is blocked" });
      }

      const { password: _, ...userWithoutPassword } = found;
      res.json(userWithoutPassword);
    } catch (error: any) {
      console.error("Auth login error:", error);
      res.status(500).json({ error: error.message || "Login failed" });
    }
  });

  app.get("/api/auth/users", async (_req: Request, res: Response) => {
    try {
      const allUsers = await db.select().from(appUsers);
      const usersWithoutPasswords = allUsers.map(({ password, ...rest }) => rest);
      res.json(usersWithoutPasswords);
    } catch (error: any) {
      console.error("Auth get users error:", error);
      res.status(500).json({ error: error.message || "Failed to get users" });
    }
  });

  app.put("/api/auth/users/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      delete updates.id;

      const updateData: Record<string, any> = {};
      if (updates.email !== undefined) updateData.email = updates.email;
      if (updates.password !== undefined) updateData.password = updates.password;
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.role !== undefined) updateData.role = updates.role;
      if (updates.credits !== undefined) updateData.credits = updates.credits;
      if (updates.blocked !== undefined) updateData.blocked = updates.blocked;
      if (updates.freeTrialMessages !== undefined) updateData.freeTrialMessages = updates.freeTrialMessages;
      if (updates.usedMessages !== undefined) updateData.usedMessages = updates.usedMessages;
      if (updates.freePhotoGenerations !== undefined) updateData.freePhotoGenerations = updates.freePhotoGenerations;
      if (updates.usedPhotoGenerations !== undefined) updateData.usedPhotoGenerations = updates.usedPhotoGenerations;
      if (updates.freeVideoGenerations !== undefined) updateData.freeVideoGenerations = updates.freeVideoGenerations;
      if (updates.usedVideoGenerations !== undefined) updateData.usedVideoGenerations = updates.usedVideoGenerations;

      const [updated] = await db.update(appUsers).set(updateData).where(eq(appUsers.id, id)).returning();
      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }

      const { password: _, ...userWithoutPassword } = updated;
      res.json(userWithoutPassword);
    } catch (error: any) {
      console.error("Auth update user error:", error);
      res.status(500).json({ error: error.message || "Failed to update user" });
    }
  });

  app.delete("/api/auth/users/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await db.delete(appUsers).where(eq(appUsers.id, id));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Auth delete user error:", error);
      res.status(500).json({ error: error.message || "Failed to delete user" });
    }
  });

  app.post("/api/auth/sync", async (req: Request, res: Response) => {
    try {
      const userData = req.body;
      if (!userData || !userData.email) {
        return res.status(400).json({ error: "User data with email is required" });
      }

      const existing = await db.select().from(appUsers).where(eq(appUsers.email, userData.email.toLowerCase()));

      if (existing.length > 0) {
        const [updated] = await db.update(appUsers).set({
          name: userData.name,
          password: userData.password,
          role: userData.role || "user",
          credits: userData.credits ?? 0,
          blocked: userData.blocked ?? false,
          freeTrialMessages: userData.freeTrialMessages ?? 5,
          usedMessages: userData.usedMessages ?? 0,
          freePhotoGenerations: userData.freePhotoGenerations ?? 1,
          usedPhotoGenerations: userData.usedPhotoGenerations ?? 0,
          freeVideoGenerations: userData.freeVideoGenerations ?? 1,
          usedVideoGenerations: userData.usedVideoGenerations ?? 0,
        }).where(eq(appUsers.email, userData.email.toLowerCase())).returning();

        const { password: _, ...userWithoutPassword } = updated;
        res.json(userWithoutPassword);
      } else {
        const id = userData.id || randomUUID();
        const [newUser] = await db.insert(appUsers).values({
          id,
          email: userData.email.toLowerCase(),
          password: userData.password,
          name: userData.name,
          role: userData.role || "user",
          credits: userData.credits ?? 0,
          blocked: userData.blocked ?? false,
          createdAt: userData.createdAt || new Date().toISOString(),
          freeTrialMessages: userData.freeTrialMessages ?? 5,
          usedMessages: userData.usedMessages ?? 0,
          freePhotoGenerations: userData.freePhotoGenerations ?? 1,
          usedPhotoGenerations: userData.usedPhotoGenerations ?? 0,
          freeVideoGenerations: userData.freeVideoGenerations ?? 1,
          usedVideoGenerations: userData.usedVideoGenerations ?? 0,
        }).returning();

        const { password: _, ...userWithoutPassword } = newUser;
        res.json(userWithoutPassword);
      }
    } catch (error: any) {
      console.error("Auth sync error:", error);
      res.status(500).json({ error: error.message || "Sync failed" });
    }
  });
}
