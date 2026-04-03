import { prisma } from "./prisma"

/**
 * Checks if a branch with the given name already exists in the repository.
 * Returns an error object if duplicate exists, null otherwise.
 */
export async function checkDuplicateBranchName(
  repoId: string,
  name: string
): Promise<{ error: string } | null> {
  const existingBranch = await prisma.branch.findUnique({
    where: {
      repoId_name: {
        repoId,
        name,
      },
    },
  })

  if (existingBranch) {
    return { error: `A branch named "${name}" already exists in this repository` }
  }

  return null
}
