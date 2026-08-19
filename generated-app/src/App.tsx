import { CssBaseline, Box, AppBar, Toolbar, Typography } from "@mui/material";
import { CarInventory } from "@/components/CarInventory";

export function App() {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div">
            Car Inventory Manager
          </Typography>
        </Toolbar>
      </AppBar>
      <Box component="main">
        <CarInventory />
      </Box>
    </Box>
  );
}

export default App;