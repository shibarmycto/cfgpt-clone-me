import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const appUsers = pgTable("app_users", {
  id: varchar("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("user"),
  credits: integer("credits").notNull().default(0),
  blocked: boolean("blocked").notNull().default(false),
  createdAt: text("created_at").notNull(),
  freeTrialMessages: integer("free_trial_messages").notNull().default(5),
  usedMessages: integer("used_messages").notNull().default(0),
  freePhotoGenerations: integer("free_photo_generations").notNull().default(1),
  usedPhotoGenerations: integer("used_photo_generations").notNull().default(0),
  freeVideoGenerations: integer("free_video_generations").notNull().default(1),
  usedVideoGenerations: integer("used_video_generations").notNull().default(0),
});
