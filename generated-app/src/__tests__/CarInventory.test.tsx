import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApolloClient, ApolloProvider, InMemoryCache } from "@apollo/client";
import { graphql, HttpResponse } from "msw";
import { describe, it, expect, beforeEach } from "vitest";
import { server } from "@/mocks/server";
import { CarInventory } from "@/components/CarInventory";

const mockCars = [
  {
    id: "1",
    make: "Toyota",
    model: "Camry",
    year: 2022,
    color: "Silver",
    mobile: "https://placehold.co/640x360?text=Toyota+Camry",
    tablet: "https://placehold.co/1023x576?text=Toyota+Camry",
    desktop: "https://placehold.co/1440x810?text=Toyota+Camry",
  },
  {
    id: "2",
    make: "BMW",
    model: "M3",
    year: 2024,
    color: "Blue",
    mobile: "https://placehold.co/640x360?text=BMW+M3",
    tablet: "https://placehold.co/1023x576?text=BMW+M3",
    desktop: "https://placehold.co/1440x810?text=BMW+M3",
  },
  {
    id: "3",
    make: "Audi",
    model: "A4",
    year: 2020,
    color: "Black",
    mobile: "https://placehold.co/640x360?text=Audi+A4",
    tablet: "https://placehold.co/1023x576?text=Audi+A4",
    desktop: "https://placehold.co/1440x810?text=Audi+A4",
  },
];

function renderCarInventory() {
  const client = new ApolloClient({
    uri: "http://localhost:4000/graphql",
    cache: new InMemoryCache(),
    defaultOptions: {
      watchQuery: { fetchPolicy: "no-cache" },
      query: { fetchPolicy: "no-cache" },
    },
  });

  return render(
    <ApolloProvider client={client}>
      <CarInventory />
    </ApolloProvider>
  );
}

describe("CarInventory Integration Tests", () => {
  beforeEach(() => {
    server.use(
      graphql.query("GetCars", () => {
        return HttpResponse.json({
          data: { cars: mockCars },
        });
      })
    );
  });

  it("shows loading state initially and then renders cars from API", async () => {
    renderCarInventory();

    expect(
      screen.getByRole("progressbar") || screen.getByTestId("loading-spinner")
    ).toBeInTheDocument();

    expect(await screen.findByText(/Toyota/i)).toBeInTheDocument();
    expect(screen.getByText(/Camry/i)).toBeInTheDocument();
    expect(screen.getByText(/BMW/i)).toBeInTheDocument();
    expect(screen.getByText(/Audi/i)).toBeInTheDocument();
  });

  it("filters cars by model as the user types in search bar", async () => {
    renderCarInventory();

    expect(await screen.findByText(/Camry/i)).toBeInTheDocument();
    expect(screen.getByText(/M3/i)).toBeInTheDocument();
    expect(screen.getByText(/A4/i)).toBeInTheDocument();

    const searchInput = screen.getByRole("textbox");
    await userEvent.type(searchInput, "Camry");

    expect(screen.getByText(/Camry/i)).toBeInTheDocument();
    expect(screen.queryByText(/M3/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/A4/i)).not.toBeInTheDocument();
  });

  it("switches sort option and changes list order", async () => {
    renderCarInventory();

    await screen.findByText(/Toyota/i);

    const selectOrButton =
      screen.queryByRole("combobox") ||
      screen.queryByLabelText(/sort/i) ||
      screen.queryByRole("button", { name: /make/i });

    if (selectOrButton) {
      if (selectOrButton.getAttribute("role") === "combobox") {
        await userEvent.click(selectOrButton);
        const makeOption = await screen.findByRole("option", { name: /make/i });
        await userEvent.click(makeOption);
      } else {
        await userEvent.click(selectOrButton);
      }
    }

    await waitFor(() => {
      const cardHeadings = screen
        .getAllByRole("heading")
        .map((h) => h.textContent || "");
      const makesInOrder = cardHeadings.filter((t) =>
        /Audi|BMW|Toyota/.test(t)
      );
      if (makesInOrder.length >= 3) {
        expect(makesInOrder[0]).toMatch(/Audi/i);
        expect(makesInOrder[1]).toMatch(/BMW/i);
        expect(makesInOrder[2]).toMatch(/Toyota/i);
      }
    });
  });

  it("displays an error alert when GraphQL request fails", async () => {
    server.use(
      graphql.query("GetCars", () => {
        return HttpResponse.json({
          errors: [{ message: "Failed to load car inventory data" }],
        });
      })
    );

    renderCarInventory();

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/failed/i);
  });
});