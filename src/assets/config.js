// Gillbert API Configuration
// Shared across all pages — load this script before any page-specific scripts.

const N8N_BASE_URL = "https://api.builtbykw.net";
const WEBHOOK_PATH = "/webhook/";
const API_KEY      = 'ac89c77eaa95002649c596434b2e63eac8cc6694f97cefed6d91f7e0354eabe4';

const API_BASE        = N8N_BASE_URL + WEBHOOK_PATH + "gillbert/";
const CATCHES_GET_URL = API_BASE + "get-catches";

const FISH_SPECIES_GET_URL    = API_BASE + "fish-species/get";
const FISH_SPECIES_SAVE_URL = API_BASE + "fish-species/save";

const BODIES_OF_WATER_GET_URL        = API_BASE + "bodies-of-water/get";
const BODIES_OF_WATER_SAVE_URL       = API_BASE + "bodies-of-water/save";
const BODIES_OF_WATER_DNR_SEARCH_URL = API_BASE + "bodies-of-water/dnr-search";
