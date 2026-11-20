import { z } from 'zod';
import { id } from '../validation.js';

export const transferInput = z.object({ newOwnerId: id }).strict();
