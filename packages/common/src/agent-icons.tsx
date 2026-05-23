/**
 * Agent icon components - shared between web and simple-chat packages
 */

import type { Agent } from "./agents"
import { cn } from "./utils"

interface AgentIconProps {
  className?: string
}

// Claude Code icon - Official Anthropic Claude AI logo
// Source: https://github.com/simple-icons/simple-icons
export function ClaudeCodeIcon({ className }: AgentIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4", className)}
    >
      <path
        d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
        fill="currentColor"
      />
    </svg>
  )
}

// Codex icon - Official OpenAI logo
// Source: https://www.svgrepo.com/show/306500/openai.svg
export function CodexIcon({ className }: AgentIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4", className)}
    >
      <path
        d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
        fill="currentColor"
      />
    </svg>
  )
}

// Copilot icon - GitHub Copilot logo
// Source: https://github.com/simple-icons/simple-icons (GitHub Copilot)
export function CopilotIcon({ className }: AgentIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4", className)}
    >
      <path
        d="M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z"
        fill="currentColor"
      />
    </svg>
  )
}

// OpenCode icon - Official OpenCode logo
// Source: https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/opencode.svg
// Centered within square viewBox, background removed
export function OpenCodeIcon({ className }: AgentIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4", className)}
    >
      {/* Inner lighter rectangle (bottom portion) */}
      <path
        d="M17 21H7V12H17V21Z"
        fill="currentColor"
        fillOpacity="0.4"
      />
      {/* Outer rectangle frame */}
      <rect
        x="7"
        y="3"
        width="10"
        height="18"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
    </svg>
  )
}

// Gemini icon - Google Gemini logo (stylized star)
// Source: https://github.com/simple-icons/simple-icons
export function GeminiIcon({ className }: AgentIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4", className)}
    >
      <path
        d="M12 0C12 6.627 17.373 12 24 12c-6.627 0-12 5.373-12 12 0-6.627-5.373-12-12-12 6.627 0 12-5.373 12-12z"
        fill="currentColor"
      />
    </svg>
  )
}

// Goose icon - Block's Goose AI agent logo (stylized goose)
// Simplified goose silhouette
export function GooseIcon({ className }: AgentIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4", className)}
    >
      {/* Goose head and neck */}
      <path
        d="M6 4c0-1.1.9-2 2-2h1c1.1 0 2 .9 2 2v2c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1V4z"
        fill="currentColor"
      />
      {/* Beak */}
      <path
        d="M5 5h1v1H5z"
        fill="currentColor"
      />
      {/* Body */}
      <ellipse
        cx="12"
        cy="14"
        rx="6"
        ry="5"
        fill="currentColor"
      />
      {/* Neck connecting head to body */}
      <path
        d="M9 7v3c0 1 1 2 2 2h2c1 0 2-1 2-2V9"
        fill="currentColor"
      />
      {/* Legs */}
      <path
        d="M10 19v3M14 19v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Feet */}
      <path
        d="M8 22h4M12 22h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ELIZA icon - Robot face with a friendly smile
// Represents the classic ELIZA chatbot as a friendly robot therapist
export function ElizaIcon({ className }: AgentIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4", className)}
    >
      {/* Robot head outline */}
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="3"
        fill="currentColor"
      />
      {/* Left eye */}
      <circle cx="9" cy="10" r="2" fill="currentColor" className="fill-background" />
      {/* Right eye */}
      <circle cx="15" cy="10" r="2" fill="currentColor" className="fill-background" />
      {/* Smile - curved arc */}
      <path
        d="M8 15C8 15 9.5 17 12 17C14.5 17 16 15 16 15"
        stroke="currentColor"
        className="stroke-background"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Antenna */}
      <line
        x1="12"
        y1="1"
        x2="12"
        y2="4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="1" r="1" fill="currentColor" />
    </svg>
  )
}

// Kilo icon - Official Kilo Code logo
// Source: https://github.com/Kilo-Org/kilocode (kilo-v1.svg)
export function KiloIcon({ className }: AgentIconProps) {
  return (
    <svg
      viewBox="0 0 50 50"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4", className)}
    >
      <path
        d="M0,0v50h50V0H0ZM46.2962963,46.2962963H3.7037037V3.7037037h42.5925926v42.5925926ZM30.5555522,35.9548042h4.6296296v3.7037037h-5.8201058l-2.5132275-2.5132275v-5.8201058h3.7037037v4.6296296ZM38.8888855,35.9548042h-3.7037037v-4.6296296h-4.6296296v-3.7037037h5.8201058l2.5132275,2.5132275v5.8201058ZM23.1481481,30.5557103h-3.7037037v-3.7037037h3.7037037v3.7037037ZM11.1111111,26.8520066h3.7037037v8.3333333h8.3333333v3.7037037h-9.5238095l-2.5132275-2.5132275v-9.5238095ZM38.8888855,19.4444444v3.7037037h-12.037037v-3.7037037h4.1390959v-4.6296296h-4.1390959v-3.7037037h5.3295721l2.5132275,2.5132275v5.8201058h4.1942374ZM14.8148148,15.2777778h4.6296296l3.7037037,3.7037037v4.1666667h-3.7037037v-4.1666667h-4.6296296v4.1666667h-3.7037037v-12.037037h3.7037037v4.1666667ZM23.1481481,15.2777778h-3.7037037v-4.1666667h3.7037037v4.1666667Z"
        fill="currentColor"
      />
    </svg>
  )
}

// Pi icon - Official Pi Coding Agent logo
// Source: https://shittycodingagent.ai/logo.svg
export function PiIcon({ className }: AgentIconProps) {
  return (
    <svg
      viewBox="0 0 800 800"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4", className)}
    >
      {/* P shape: outer boundary clockwise, inner hole counter-clockwise */}
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
      />
      {/* i dot */}
      <path
        fill="currentColor"
        d="M517.36 400H634.72V634.72H517.36Z"
      />
    </svg>
  )
}

// Helper function to get the icon component for an agent
export function AgentIcon({ agent, className }: { agent: Agent; className?: string }) {
  switch (agent) {
    case "claude-code":
      return <ClaudeCodeIcon className={className} />
    case "codex":
      return <CodexIcon className={className} />
    case "copilot":
      return <CopilotIcon className={className} />
    case "eliza":
      return <ElizaIcon className={className} />
    case "opencode":
      return <OpenCodeIcon className={className} />
    case "gemini":
      return <GeminiIcon className={className} />
    case "goose":
      return <GooseIcon className={className} />
    case "kilo":
      return <KiloIcon className={className} />
    case "pi":
      return <PiIcon className={className} />
    default:
      return <ClaudeCodeIcon className={className} />
  }
}
