/**
 * API System Update - Controlla e applica aggiornamenti da GitHub
 * GET: Controlla se ci sono aggiornamenti disponibili
 * POST: Scarica e applica l'aggiornamento
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { execSync, spawn } from "child_process";
import path from "path";
import fs from "fs";
import { isContainerDeploy } from "@/lib/env-secrets";
import {
  pickPm2Process,
  pickServiceToRestart,
  readPm2Ids,
  readServiceStates,
  restartWithSystemd,
} from "@/lib/app-service";
import {
  getConfiguredUpdateBranch,
  getGitBranch,
  isGitUpdateSupported,
} from "@/lib/update-branch";

const REPO_API_URL = "https://api.github.com/repos/grandir66/DA-IPAM";
const REPO_RAW_URL = "https://raw.githubusercontent.com/grandir66/DA-IPAM";

