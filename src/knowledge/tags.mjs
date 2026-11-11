const RULES = [
  ["визуализатор", /^(?:spawn_(?:text|block|item)_display|set_(?:text_|block_|item_)?display_|reset_(?:text_)?display_|value\.display_entity_)/],
  ["голограмма", /^(?:spawn_text_display|set_text_display_|display_hologram)/],
  ["частицы", /^display_particle/],
  ["звук", /^(?:play_sound|play_sound_|stop_sound)/],
  ["тайтл", /^(?:show_title|send_title|send_action_bar|send_actionbar)/],
  ["боссбар", /boss_bar/],
  ["скорборд", /scoreboard/],
  ["таб", /^(?:set_player_list|set_tab_list|set_list_)/],
  ["меню", /^(?:show_inventory_menu|expand_inventory_menu|set_inventory_menu_|close_inventory|value\.open_inventory_title)/],
  ["луч", /^(?:filter_by_raycast|ray_trace_result)/],
  ["снаряд", /projectile/],
  ["вектор", /^(?:vector_|add_vectors|shift_location_on_vector|launch_up|launch_forward|launch_to|set_velocity|value\.direction_of_view|value\.velocity)/],
  ["блоки", /^(?:set_block|fill_region|clone_region|clear_region|game\.set_block|get_block)/],
  ["генерация", /(?:perlin|noise|simplex|voronoi)/],
  ["моб", /^(?:spawn_mob|set_ai|all_mobs|entity_by_name|set_mob_)/],
  ["путь", /pathfinder|^has_available_path/],
  ["маскировка", /disguise/],
  ["рецепт", /recipe/],
  ["инвентарь", /^(?:give_items|set_items|clear_inventory|set_equipment|has_item|value\.main_hand_item)/],
  ["хранение", /^(?:save_inventory|load_inventory|create_map|create_list|set_map_value|get_map_value|append_value|sort_list|sort_map)/],
  ["команда", /^chat_message_equals$|^value\.event_chat_message$/],
  ["таймер", /^(?:value\.timestamp|value\.server_current_tick|set_item_cooldown)/],
  ["мир", /^(?:set_world_|set_time|set_weather|set_gamerule|set_game_rule|set_world_border)/],
];

export const TAGS = RULES.map(([tag]) => tag);

export function tagsOf(symbols, event = "") {
  const list = [...symbols];
  const out = [];
  for (const [tag, rule] of RULES) if (list.some((s) => rule.test(s))) out.push(tag);
  if (/projectile/.test(event)) out.push("снаряд");
  return [...new Set(out)];
}
