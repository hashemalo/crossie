/**
 * Username utility functions for consistent validation across the application
 */

/**
 * Sanitizes a username to only allow lowercase letters, numbers, dots, and underscores
 * @param username - The raw username input
 * @returns The sanitized username
 */
export function sanitizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/[^a-z0-9._]/g, '');
}

/**
 * Validates if a username meets the required format
 * @param username - The username to validate
 * @returns Object with isValid boolean and error message if invalid
 */
export function validateUsername(username: string): { isValid: boolean; error?: string } {
  const sanitized = sanitizeUsername(username);
  
  if (!sanitized) {
    return {
      isValid: false,
      error: 'Username must contain at least one valid character (letters, numbers, dots, or underscores)'
    };
  }
  
  if (sanitized.length < 2) {
    return {
      isValid: false,
      error: 'Username must be at least 2 characters long'
    };
  }
  
  if (sanitized.length > 50) {
    return {
      isValid: false,
      error: 'Username cannot be longer than 50 characters'
    };
  }
  
  // Check if it starts or ends with dots or underscores (optional rule)
  if (sanitized.startsWith('.') || sanitized.startsWith('_') || 
      sanitized.endsWith('.') || sanitized.endsWith('_')) {
    return {
      isValid: false,
      error: 'Username cannot start or end with dots or underscores'
    };
  }
  
  return { isValid: true };
}

/**
 * Regex pattern for username validation (for HTML input pattern attribute)
 */
export const USERNAME_PATTERN = '^[a-z0-9._]+$';

/**
 * Description of username requirements for user display
 */
export const USERNAME_REQUIREMENTS = 'Only lowercase letters, numbers, dots (.), and underscores (_) allowed. Must be 2-50 characters and cannot start/end with dots or underscores.'; 