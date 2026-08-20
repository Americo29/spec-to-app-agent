import {
  AppBar,
  Toolbar,
  Typography,
  Container,
  CssBaseline,
  Box,
} from "@mui/material";
import { CarInventory } from "@/components/CarInventory";

export function App() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Car Inventory Manager
          </Typography>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" component="main" sx={{ mt: 4, mb: 4, flex: 1 }}>
        <CarInventory />
      </Container>
    </Box>
  );
}

export default App;